import { capture, isAgentCommand } from "../core/transport/ssh";
import { tmux } from "../core/transport/tmux";
import type { MawWS } from "../core/types";

type SessionInfo = { name: string; windows: { index: number; name: string; active: boolean }[] };

/**
 * จำนวนบรรทัดที่ push ให้จอ pane — **0 = จอปัจจุบันล้วน ไม่เอาประวัติ**
 *
 * เดิมเป็น 80 ⇒ ทุกรอบ push จะแนบ "ประวัติการวาดใหม่" ของ TUI มาด้วย
 * TUI ของ Claude วาดแถบล่างทับที่เดิมตลอด ⇒ ทุกครั้งที่วาด ประวัติได้สำเนาเพิ่มอีกชุด
 * ⇒ บนจอผู้ใช้เห็นเป็น "เนื้อซ้ำ ท่อนเก่าปนใหม่ + บรรทัดว่างเป็นพืด" (📎 Boss รายงาน 15.08)
 * ซึ่ง **ไม่ใช่ของที่เพี้ยน — เป็นของที่เราขอมาเอง**
 *
 * ประวัติจริงมีทางของมันอยู่แล้ว 2 ทาง ไม่ต้องยัดมากับ push ที่ยิงทุก ~50ms:
 *   `/api/capture?lines=N` (เพดาน 50000 · sessions.ts) และ replay ตอน attach ของ /ws/pty
 */
const PANE_PUSH_LINES = 0;

/** Push terminal capture to a subscribed WebSocket client. */
export async function pushCapture(
  ws: MawWS,
  lastContent: Map<MawWS, string>,
) {
  if (!ws.data.target) return;
  try {
    const content = await capture(ws.data.target, PANE_PUSH_LINES);
    const prev = lastContent.get(ws);
    if (content !== prev) {
      lastContent.set(ws, content);
      ws.send(JSON.stringify({ type: "capture", target: ws.data.target, content }));
    }
  } catch (e: any) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}

/** Push preview captures for subscribed targets (15 lines to catch status text like "Compacting"). */
export async function pushPreviews(
  ws: MawWS,
  lastPreviews: Map<MawWS, Map<string, string>>,
) {
  const targets = ws.data.previewTargets;
  if (!targets || targets.size === 0) return;
  const prevMap = lastPreviews.get(ws) || new Map<string, string>();
  const changed: Record<string, string> = {};
  let hasChanges = false;

  await Promise.allSettled([...targets].map(async (target) => {
    try {
      const content = await capture(target, 15);
      const prev = prevMap.get(target);
      if (content !== prev) {
        prevMap.set(target, content);
        changed[target] = content;
        hasChanges = true;
      }
    } catch { /* expected: capture may fail for inactive pane */ }
  }));

  lastPreviews.set(ws, prevMap);
  if (hasChanges) {
    ws.send(JSON.stringify({ type: "previews", data: changed }));
  }
}

/** Broadcast session list to all clients (only if changed).
 *  peerSessions — optional extra sessions from federated peers (tagged with source).
 *  cache.sessions always holds local-only sessions for status detection / busy-agent scanning.
 */
export async function broadcastSessions(
  clients: Set<MawWS>,
  cache: { sessions: SessionInfo[]; json: string },
  peerSessions: SessionInfo[] = [],
): Promise<SessionInfo[]> {
  if (clients.size === 0) return cache.sessions;
  try {
    const local = await tmux.listAll();
    const all = peerSessions.length > 0 ? [...local, ...peerSessions] : local;
    cache.sessions = local;
    cache.json = JSON.stringify(all);
    const msg = JSON.stringify({ type: "sessions", sessions: all });
    for (const ws of clients) ws.send(msg);
    return local;
  } catch {
    return cache.sessions;
  }
}

/** Scan panes for running claude and send `recent` to client. */
export async function sendBusyAgents(ws: MawWS, sessions: SessionInfo[]) {
  const allTargets = sessions.flatMap(s => s.windows.map(w => `${s.name}:${w.index}`));
  const cmds = await tmux.getPaneCommands(allTargets);
  const busy = allTargets
    .filter(t => isAgentCommand(cmds[t]))
    .map(t => {
      const [session] = t.split(":");
      const s = sessions.find(x => x.name === session);
      const w = s?.windows.find(w => `${s.name}:${w.index}` === t);
      return { target: t, name: w?.name || t, session };
    });
  if (busy.length > 0) {
    ws.send(JSON.stringify({ type: "recent", agents: busy }));
  }
}
