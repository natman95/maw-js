import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveTargetCwd as defaultResolveCwd } from "../../commands/shared/target-cwd";

/**
 * Marker the MAW dashboard injects when Boss attaches a file to an Oracle.
 * Source of truth: maw-ui `TerminalModal.tsx` / `TerminalView.tsx`
 *   image:     send({ ..., text: `[ภาพแนบ — โปรดดู: ${path}]\n` })
 *   any file:  send({ ..., text: `[ไฟล์แนบ — โปรดดู: ${path}]\n` })
 * Boss can now attach pdf/word/excel/txt as well as images (2026-06-13), so the
 * marker label is either ภาพแนบ (image) or ไฟล์แนบ (any other file). Keep this
 * regex in sync with both strings.
 */
const ATTACH_RE = /\[(?:ภาพแนบ|ไฟล์แนบ)[^\]]*?:\s*([^\]\s]+)\s*\]/;

/** Extract the attached-file path from an injected `send` text, or null. */
export function extractAttachPath(text: string): string | null {
  if (!text) return null;
  const m = text.match(ATTACH_RE);
  return m ? m[1] : null;
}

export interface StubDeps {
  resolveCwd?: (target: string) => string | null;
  now?: () => number;
  write?: (path: string, data: string) => Promise<void>;
  mkdirp?: (dir: string) => Promise<void>;
}

/**
 * Image-attach wake-stub (#image-stall, 2026-06-07).
 *
 * When Boss attaches an image to an *idle* Oracle via the MAW dashboard, the
 * dashboard injects `[ภาพแนบ — โปรดดู: <path>]` straight into the pane via
 * send-keys (the `send` handler). An idle session has no active turn to fire,
 * and `oracle-inbox-sweep-all` — the cron that wakes offline sessions — only
 * watches top-level `ψ/inbox/*.md`, so it never sees the injected prompt. The
 * image then sits unanswered until Boss re-pings (observed 2026-06-06; worst for
 * Nari, who idles most).
 *
 * Fix: additionally drop a top-level inbox stub so the EXISTING sweep wakes the
 * session within ≤20 min. Additive only — does NOT touch the fire-turn path.
 * Fully fail-safe: every error is swallowed; image delivery must never be
 * blocked by stub bookkeeping.
 *
 * The inbox path is derived from the SAME fleet resolver `wake`/`restart` use
 * (`resolveTargetCwd`), so it stays correct for non-standard repos — notably
 * Nari, whose canonical inbox is `/root/projects/tconhr`, NOT `nari-oracle`
 * (fleet `05-nari.json` → `"repo": "tconhr"`). A naive `<oracle>-oracle` map
 * would silently drop into the dormant repo.
 *
 * Stub filename satisfies the sweep's find contract
 * (`oracle-inbox-sweep.sh`: top-level `*.md`, not `.*`, not `__CANARY-*`).
 *
 * @returns the written stub path, or null when skipped (no marker / unresolved
 *          non-fleet target / write failure).
 */
export async function dropImageNotifyStub(
  target: string,
  text: string,
  deps: StubDeps = {},
): Promise<string | null> {
  try {
    const attachPath = extractAttachPath(text);
    if (!attachPath) return null; // not an image send — no-op

    const resolveCwd = deps.resolveCwd ?? defaultResolveCwd;
    const cwd = resolveCwd(target);
    if (!cwd) return null; // non-fleet target — can't locate ψ/inbox safely

    const now = deps.now ?? (() => Date.now());
    const ts = Math.floor(now() / 1000);
    const file = attachPath.split("/").pop() || "attachment";
    const stubName = `${ts}_from-boss_attach-${file}.md`;
    const inboxDir = join(cwd, "ψ", "inbox");
    const stubPath = join(inboxDir, stubName);

    const body = [
      "---",
      "from: boss",
      `to: ${target}`,
      "subject: 📎 File attachment received via MAW dashboard",
      "type: attach-notify",
      "status: delivered",
      "---",
      "",
      "Boss attached a file — it was injected into this session as a live prompt:",
      "",
      `  [ไฟล์แนบ — โปรดดู: ${attachPath}]`,
      "",
      `Open it with: \`Read ${attachPath}\``,
      "",
      "_Auto-stub from the maw bridge so the inbox sweep wakes idle sessions. The",
      "attachment prompt above was already delivered to the pane; this file exists",
      "only to trigger a wake when the session was idle at arrival._",
      "",
    ].join("\n");

    const mkdirp =
      deps.mkdirp ?? ((dir: string) => mkdir(dir, { recursive: true }).then(() => {}));
    const write =
      deps.write ?? ((p: string, d: string) => writeFile(p, d, { mode: 0o644 }));

    await mkdirp(inboxDir);
    await write(stubPath, body);
    return stubPath;
  } catch {
    return null; // never propagate — image delivery must not depend on this
  }
}
