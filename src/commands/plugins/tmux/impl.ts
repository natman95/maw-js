import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { hostExec, tmux } from "../../../sdk";
import { resolveSessionTarget } from "../../../core/matcher/resolve-target";
import { loadFleetEntries } from "../../shared/fleet-load";

const TEAMS_DIR = join(homedir(), ".claude/teams");

export interface TmuxPeekOpts {
  /** Number of lines from bottom of pane buffer. Default 30. */
  lines?: number;
  /** Include full scrollback (-S -). Overrides --lines. */
  history?: boolean;
}

/**
 * Resolve a user-supplied target into a tmux pane identifier suitable for
 * `tmux capture-pane -pt <id>`.
 *
 * Resolution order:
 *   1. Pane ID literal (e.g. "%776")
 *   2. Fully-qualified session:w.p (e.g. "101-mawjs:0.1")
 *   3. Team agent name → walk ~/.claude/teams/* /config.json, find member
 *   4. Bare session name → <target>:0 (pane 0)
 *
 * Returns the resolved target and a human-readable "how I found it" note.
 */
export function resolveTmuxTarget(target: string): { resolved: string; source: string } | null {
  // 1. Pane ID
  if (/^%\d+$/.test(target)) return { resolved: target, source: "pane-id" };

  // 2. session:w.p
  if (/^[\w.-]+:\d+\.\d+$/.test(target)) return { resolved: target, source: "session:w.p" };

  // 3. Team agent name — walk team configs
  if (existsSync(TEAMS_DIR)) {
    for (const dir of readdirSync(TEAMS_DIR)) {
      const cfg = join(TEAMS_DIR, dir, "config.json");
      if (!existsSync(cfg)) continue;
      try {
        const team = JSON.parse(readFileSync(cfg, "utf-8"));
        for (const m of team.members ?? []) {
          if (m?.name === target && m?.tmuxPaneId && m.tmuxPaneId !== "" && m.tmuxPaneId !== "in-process") {
            return { resolved: m.tmuxPaneId, source: `team-agent (${dir})` };
          }
        }
      } catch { /* skip bad config */ }
    }
  }

  // 3.5 — Fleet session by bare stem (#394 Bug I). e.g. "mawjs-no2" → "114-mawjs-no2:0".
  // Matches maw peek's resolution. Suffix-preferred via the canonical
  // resolveSessionTarget so "mawjs" → "101-mawjs" (not "mawjs-view").
  try {
    const sessions = loadFleetEntries().map(e => ({ name: e.file.replace(/\.json$/, "") }));
    const r = resolveSessionTarget(target, sessions);
    if (r.kind === "exact" || r.kind === "fuzzy") {
      return { resolved: `${r.match.name}:0`, source: `fleet-stem (${r.match.name})` };
    }
  } catch { /* no fleet dir — fall through */ }

  // 4. Bare session name → pane 0
  return { resolved: `${target}:0`, source: "session-name (pane 0)" };
}

export async function cmdTmuxPeek(target: string, opts: TmuxPeekOpts = {}): Promise<void> {
  const hit = resolveTmuxTarget(target);
  if (!hit) {
    throw new Error(`cannot resolve target '${target}'`);
  }

  const { resolved, source } = hit;
  const lines = opts.lines ?? 30;
  const scroll = opts.history ? "-S -" : `-S -${lines}`;

  let out: string;
  try {
    out = await hostExec(`tmux capture-pane -pt '${resolved}' ${scroll} -J`);
  } catch (e: any) {
    throw new Error(`tmux capture-pane failed for '${resolved}' (from ${source}): ${e?.message || e}`);
  }

  console.log(`\x1b[90m▸ ${target} → ${resolved} [${source}]\x1b[0m`);
  console.log(out);
}

export interface TmuxLsOpts {
  /** Include every pane across every session (tmux list-panes -a). Default: current session only. */
  all?: boolean;
  /** JSON output for scripting. */
  json?: boolean;
}

interface AnnotatedPane {
  id: string;
  target: string;
  command: string | undefined;
  title: string | undefined;
  annotation: string; // "fleet: X" | "team: agent @ team-name" | "orphan" | ""
}

/**
 * List tmux panes with fleet + team annotations. Supersedes `maw panes`
 * with smarter labeling — if a pane is a fleet oracle or a team agent,
 * say so explicitly so operators don't need to cross-check configs.
 */
export async function cmdTmuxLs(opts: TmuxLsOpts = {}): Promise<void> {
  const allPanes = await tmux.listPanes();
  const currentSession = process.env.TMUX
    ? (await hostExec("tmux display-message -p '#{session_name}'").catch(() => "")).trim()
    : "";

  // Fleet sessions for annotation
  const fleetSessions = new Set<string>();
  try {
    for (const entry of loadFleetEntries()) {
      fleetSessions.add(entry.file.replace(/\.json$/, ""));
    }
  } catch { /* no fleet dir */ }

  // Team members for annotation: pane_id → "agent @ team-name"
  const teamByPane = new Map<string, string>();
  if (existsSync(TEAMS_DIR)) {
    for (const dir of readdirSync(TEAMS_DIR)) {
      const cfg = join(TEAMS_DIR, dir, "config.json");
      if (!existsSync(cfg)) continue;
      try {
        const team = JSON.parse(readFileSync(cfg, "utf-8"));
        for (const m of team.members ?? []) {
          if (m?.tmuxPaneId && m.tmuxPaneId !== "" && m.tmuxPaneId !== "in-process") {
            teamByPane.set(m.tmuxPaneId, `${m.name} @ ${dir}`);
          }
        }
      } catch { /* skip bad config */ }
    }
  }

  const annotated: AnnotatedPane[] = allPanes.map(p => ({
    id: p.id,
    target: p.target,
    command: p.command,
    title: p.title,
    annotation: annotatePane(p, fleetSessions, teamByPane),
  }));

  const scope = opts.all
    ? annotated
    : annotated.filter(p => p.target.startsWith(`${currentSession}:`));

  if (opts.json) {
    console.log(JSON.stringify(scope, null, 2));
    return;
  }

  if (!scope.length) {
    console.log(opts.all
      ? "\x1b[90mNo panes found.\x1b[0m"
      : `\x1b[90mNo panes in current session '${currentSession || "(none)"}'. Use --all for every session.\x1b[0m`);
    return;
  }

  console.log();
  console.log(`  \x1b[36;1m${pad("TARGET", 28)} ${pad("CMD", 10)} ${pad("ANNOTATION", 30)} TITLE\x1b[0m`);
  for (const p of scope) {
    const annColored = p.annotation.startsWith("team:") ? `\x1b[36m${p.annotation}\x1b[0m`
      : p.annotation.startsWith("fleet:") ? `\x1b[32m${p.annotation}\x1b[0m`
      : p.annotation.startsWith("view:") ? `\x1b[90m${p.annotation}\x1b[0m`
      : p.annotation === "orphan" ? `\x1b[33morphan\x1b[0m`
      : "";
    const annPad = pad(p.annotation, 30);
    const annRendered = annColored ? annColored + annPad.slice(p.annotation.length) : annPad;
    console.log(`  ${pad(p.target, 28)} ${pad(p.command || "", 10)} ${annRendered} \x1b[90m${(p.title || "").slice(0, 50)}\x1b[0m`);
  }
  console.log();
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

/**
 * Pure annotation logic — given a pane + fleet session names + a team
 * lookup map, return the one-line label for the "ANNOTATION" column.
 * Exported for unit test.
 *
 * Precedence: team > fleet > view > orphan (claude-only) > "".
 */
export function annotatePane(
  p: { id: string; target: string; command?: string },
  fleetSessions: Set<string>,
  teamByPane: Map<string, string>,
): string {
  const session = p.target.split(":")[0] ?? "";
  const team = teamByPane.get(p.id);
  if (team) return `team: ${team}`;
  if (fleetSessions.has(session)) return `fleet: ${session.replace(/^\d+-/, "")}`;
  if (session === "maw-view" || /-view$/.test(session)) return `view: ${session}`;
  if (p.command?.includes("claude")) return "orphan";
  return "";
}
