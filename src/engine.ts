import { capture } from "./ssh";
import { tmux } from "./tmux";
import { registerBuiltinHandlers } from "./handlers";
import type { FeedEvent } from "./lib/feed";
import type { MawWS, Handler } from "./types";

export class MawEngine {
  private clients = new Set<MawWS>();
  private handlers = new Map<string, Handler>();
  private lastContent = new Map<MawWS, string>();
  private lastPreviews = new Map<MawWS, Map<string, string>>();
  private lastSessionsJson = "";
  private cachedSessions: { name: string; windows: { index: number; name: string; active: boolean }[] }[] = [];
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private sessionInterval: ReturnType<typeof setInterval> | null = null;
  private previewInterval: ReturnType<typeof setInterval> | null = null;
  private feedUnsub: (() => void) | null = null;
  private feedBuffer: FeedEvent[];
  private feedListeners: Set<(event: FeedEvent) => void>;

  constructor({ feedBuffer, feedListeners }: { feedBuffer: FeedEvent[]; feedListeners: Set<(event: FeedEvent) => void> }) {
    this.feedBuffer = feedBuffer;
    this.feedListeners = feedListeners;
    registerBuiltinHandlers(this);
  }

  /** Register a WebSocket message handler */
  on(type: string, handler: Handler) {
    this.handlers.set(type, handler);
  }

  // --- WebSocket lifecycle ---

  handleOpen(ws: MawWS) {
    this.clients.add(ws);
    this.startIntervals();
    if (this.cachedSessions.length > 0) {
      ws.send(JSON.stringify({ type: "sessions", sessions: this.cachedSessions }));
      this.sendBusyAgents(ws);
    } else {
      tmux.listAll().then(sessions => {
        this.cachedSessions = sessions;
        ws.send(JSON.stringify({ type: "sessions", sessions }));
        this.sendBusyAgents(ws);
      }).catch(() => {});
    }
    ws.send(JSON.stringify({ type: "feed-history", events: this.feedBuffer.slice(-50) }));
  }

  /** Scan panes for busy agents and send `recent` message to client. */
  private async sendBusyAgents(ws: MawWS) {
    const allTargets = this.cachedSessions.flatMap(s =>
      s.windows.map(w => `${s.name}:${w.index}`)
    );
    const cmds = await tmux.getPaneCommands(allTargets);
    const busy = allTargets
      .filter(t => /claude|codex|node/i.test(cmds[t] || ""))
      .map(t => {
        const [session] = t.split(":");
        const s = this.cachedSessions.find(x => x.name === session);
        const w = s?.windows.find(w => `${s.name}:${w.index}` === t);
        return { target: t, name: w?.name || t, session };
      });
    if (busy.length > 0) {
      ws.send(JSON.stringify({ type: "recent", agents: busy }));
    }
  }

  handleMessage(ws: MawWS, msg: string | Buffer) {
    try {
      const data = JSON.parse(msg as string);
      const handler = this.handlers.get(data.type);
      if (handler) handler(ws, data, this);
    } catch {}
  }

  handleClose(ws: MawWS) {
    this.clients.delete(ws);
    this.lastContent.delete(ws);
    this.lastPreviews.delete(ws);
    this.stopIntervals();
  }

  // --- Push mechanics (public — handlers use these) ---

  async pushCapture(ws: MawWS) {
    if (!ws.data.target) return;
    try {
      const content = await capture(ws.data.target, 80);
      const prev = this.lastContent.get(ws);
      if (content !== prev) {
        this.lastContent.set(ws, content);
        ws.send(JSON.stringify({ type: "capture", target: ws.data.target, content }));
      }
    } catch (e: any) {
      ws.send(JSON.stringify({ type: "error", error: e.message }));
    }
  }

  async pushPreviews(ws: MawWS) {
    const targets = ws.data.previewTargets;
    if (!targets || targets.size === 0) return;
    const prevMap = this.lastPreviews.get(ws) || new Map<string, string>();
    const changed: Record<string, string> = {};
    let hasChanges = false;

    await Promise.allSettled([...targets].map(async (target) => {
      try {
        const content = await capture(target, 3);
        const prev = prevMap.get(target);
        if (content !== prev) {
          prevMap.set(target, content);
          changed[target] = content;
          hasChanges = true;
        }
      } catch {}
    }));

    this.lastPreviews.set(ws, prevMap);
    if (hasChanges) {
      ws.send(JSON.stringify({ type: "previews", data: changed }));
    }
  }

  // --- Broadcast ---

  private async broadcastSessions() {
    if (this.clients.size === 0) return;
    try {
      const sessions = await tmux.listAll();
      this.cachedSessions = sessions;
      const json = JSON.stringify(sessions);

      if (json === this.lastSessionsJson) return;
      this.lastSessionsJson = json;
      const msg = JSON.stringify({ type: "sessions", sessions });
      for (const ws of this.clients) ws.send(msg);
    } catch {}
  }

  // --- Interval lifecycle ---

  private startIntervals() {
    if (this.captureInterval) return;
    this.captureInterval = setInterval(() => {
      for (const ws of this.clients) this.pushCapture(ws);
    }, 50);
    this.sessionInterval = setInterval(() => this.broadcastSessions(), 5000);
    this.previewInterval = setInterval(() => {
      for (const ws of this.clients) this.pushPreviews(ws);
    }, 2000);

    // Subscribe to feed events from HTTP POST /api/feed
    const listener = (event: FeedEvent) => {
      const msg = JSON.stringify({ type: "feed", event });
      for (const ws of this.clients) ws.send(msg);
    };
    this.feedListeners.add(listener);
    this.feedUnsub = () => this.feedListeners.delete(listener);
  }

  private stopIntervals() {
    if (this.clients.size > 0) return;
    if (this.captureInterval) { clearInterval(this.captureInterval); this.captureInterval = null; }
    if (this.sessionInterval) { clearInterval(this.sessionInterval); this.sessionInterval = null; }
    if (this.previewInterval) { clearInterval(this.previewInterval); this.previewInterval = null; }
    if (this.feedUnsub) { this.feedUnsub(); this.feedUnsub = null; }
  }
}
