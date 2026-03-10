import { listSessions, ssh } from "./ssh";
import type { Session } from "./ssh";

export interface OverviewTarget {
  session: string;
  window: number;
  oracle: string;
}

export function buildTargets(sessions: Session[], filters: string[]): OverviewTarget[] {
  let targets = sessions
    .filter(s => /^\d+-/.test(s.name) && s.name !== "0-overview")
    .map(s => {
      const active = s.windows.find(w => w.active) || s.windows[0];
      const oracleName = s.name.replace(/^\d+-/, "");
      return { session: s.name, window: active?.index ?? 1, oracle: oracleName };
    });

  if (filters.length) {
    targets = targets.filter(t => filters.some(f => t.oracle.includes(f) || t.session.includes(f)));
  }

  return targets;
}

export function mirrorCmd(t: OverviewTarget): string {
  const target = `${t.session}:${t.window}`;
  const label = `${t.oracle} (${target})`;
  return `while true; do clear; printf '\\033[1;36m── ${label} ──\\033[0m\\n'; maw peek ${t.oracle} 2>/dev/null || echo '(offline)'; sleep 0.5; done`;
}

export function pickLayout(count: number): string {
  return count <= 3 ? "even-horizontal" : "tiled";
}

export async function cmdOverview(filterArgs: string[]) {
  const kill = filterArgs.includes("--kill") || filterArgs.includes("-k");
  const filters = filterArgs.filter(a => !a.startsWith("-"));

  // Kill existing overview
  try { await ssh("tmux kill-session -t 0-overview 2>/dev/null"); } catch {}
  if (kill) { console.log("overview killed"); return; }

  // Gather oracle targets
  const sessions = await listSessions();
  const targets = buildTargets(sessions, filters);

  if (!targets.length) { console.error("no oracle sessions found"); return; }

  // Create overview session (first pane)
  await ssh("tmux new-session -d -s 0-overview -n war-room");

  // First pane already exists
  await ssh(`tmux send-keys -t 0-overview:war-room "${mirrorCmd(targets[0]).replace(/"/g, '\\"')}" Enter`);

  // Split for remaining targets
  for (let i = 1; i < targets.length; i++) {
    await ssh("tmux split-window -t 0-overview:war-room");
    await ssh(`tmux send-keys -t 0-overview:war-room "${mirrorCmd(targets[i]).replace(/"/g, '\\"')}" Enter`);
    await ssh("tmux select-layout -t 0-overview:war-room tiled");
  }

  // Final layout
  const layout = pickLayout(targets.length);
  await ssh(`tmux select-layout -t 0-overview:war-room ${layout}`);

  console.log(`\x1b[32m✅\x1b[0m overview: ${targets.length} oracles`);
  for (const t of targets) console.log(`  ${t.oracle} → ${t.session}:${t.window}`);
  console.log(`\n  attach: tmux attach -t 0-overview`);
}
