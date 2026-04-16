/**
 * ghq helpers — normalize paths across platforms, one source of truth.
 *
 * Motivation: `ghq list --full-path` returns backslash paths on Windows
 * (`C:\Users\...`) but every call site in maw-js uses forward-slash
 * patterns (`/repo-name$`). Normalizing inline at each call site means
 * 13+ copies of `| tr '\\' '/'` and future uses will forget it. This
 * module is the choke point — all ghq list reads go through here.
 *
 * History: PR #379 (TK7684, 2026-04-16) added inline `tr '\\' '/'`
 * at each call site. This module refactors that to a helper so future
 * ghq uses are cross-platform by default.
 *
 * All four variants (async/sync × list/find) exist because call sites
 * vary: CLI bootstrap (`cli/cmd-update.ts`) uses execSync before the
 * event loop is ready; plugin handlers use async hostExec.
 */

import { execSync } from "child_process";
import { hostExec } from "./transport/ssh";

/** Normalize raw `ghq list` output to an array of POSIX-style repo paths. */
function normalize(out: string): string[] {
  return out.split("\n").filter(Boolean).map((p) => p.replace(/\\/g, "/"));
}

/**
 * `ghq list --full-path`, normalized to forward slashes.
 * Returns [] on ghq failure (not installed, no repos, etc).
 */
export async function ghqList(): Promise<string[]> {
  const out = await hostExec("ghq list --full-path").catch(() => "");
  return normalize(out);
}

/** Sync variant — for CLI bootstrap paths where async isn't available. */
export function ghqListSync(): string[] {
  try {
    return normalize(execSync("ghq list --full-path", { encoding: "utf-8" }));
  } catch {
    return [];
  }
}

/**
 * Find the first repo path matching a regex (default: case-insensitive).
 *
 * Example: `ghqFind("/${stem}-oracle$")` replaces the common shell pattern
 * `ghq list --full-path | grep -i '/${stem}-oracle$' | head -1`.
 */
export async function ghqFind(pattern: string | RegExp, flags = "i"): Promise<string | null> {
  const regex = typeof pattern === "string" ? new RegExp(pattern, flags) : pattern;
  return (await ghqList()).find((p) => regex.test(p)) ?? null;
}

/** Sync variant of ghqFind. */
export function ghqFindSync(pattern: string | RegExp, flags = "i"): string | null {
  const regex = typeof pattern === "string" ? new RegExp(pattern, flags) : pattern;
  return ghqListSync().find((p) => regex.test(p)) ?? null;
}

/** Internal — exposed for tests only. Normalizes a raw string as if from ghq. */
export const _normalize = normalize;
