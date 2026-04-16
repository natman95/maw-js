/**
 * Canonical name-resolution helper for sessions, worktrees, and any
 * other `{ name }`-shaped items that users type bare names for.
 *
 * Why this exists:
 *   Previously the pattern `name.endsWith('-${userInput}')` was scattered
 *   across 7+ call sites. It silently picked the wrong answer when multiple
 *   items matched (e.g., target="view" matched mawjs-view, mawui-view,
 *   skills-cli-view — only the first won) and failed prefix-style names
 *   (e.g., target="mawjs" didn't match "mawjs-view").
 *
 * This helper makes resolution explicit: exact wins, otherwise collect all
 * word-segment fuzzy matches and surface ambiguity to the caller. Silent
 * wrong-answer is worse than a loud failure.
 */

export type ResolveResult<T extends { name: string }> =
  | { kind: "none"; hints?: T[] }
  | { kind: "exact"; match: T }
  | { kind: "fuzzy"; match: T }
  | { kind: "ambiguous"; candidates: T[] };

/**
 * Resolve a bare user-typed name against a list of named items.
 *
 * Four-tier cascade (suffix-preferred — matches maw tmux naming):
 *
 * 1. **exact** (case-insensitive): name === target → { kind: "exact" }.
 * 2a. **suffix word-segment**: `*-target`. Matches maw's `NN-oracle-name`
 *     session convention where user types the oracle name and expects to
 *     attach to the numbered session. 1 match → "fuzzy" (auto-pick).
 *     2+ matches → "ambiguous".
 * 2b. **prefix or middle word-segment** (only if 2a empty): `target-*` or
 *     `*-target-*`. Catches views/aux sessions shaped `<name>-view` when
 *     the user is explicitly searching for the view itself. Same
 *     auto-pick / ambiguous rules.
 * 3. **substring fallback** (only if 2a and 2b were empty): `name.includes(target)`
 *    anywhere. Matches are returned as `hints` under `kind: "none"` — they
 *    never auto-pick and never become ambiguous. Callers can render
 *    "did you mean?" but the contract still says "not found".
 *
 * Why suffix-preferred (alpha.77 fix):
 *   User report — `maw a mawjs` said ambiguous between `101-mawjs`
 *   (canonical oracle session) and `mawjs-view` (aux view). Pre-.77
 *   treated both as Tier 2 equally. Suffix-preferred breaks the tie
 *   toward the oracle convention. View sessions still resolve when
 *   the user explicitly searches for them (e.g. target=`mawjs-view`
 *   → exact; target=`view` → 2a suffix match for all `-view` aux sessions).
 *
 * Invariant: the match ladder is exact → suffix-segment → prefix/middle
 * segment → none. Substring matches are auxiliary hints, never a real
 * match. This keeps resolution predictable: a bare name either resolves
 * cleanly or the caller refuses.
 *
 * The target is trimmed before matching. An empty target returns "none"
 * with no hints — we don't want the empty string to match everything.
 */
export function resolveByName<T extends { name: string }>(
  target: string,
  items: readonly T[],
): ResolveResult<T> {
  const lc = target.trim().toLowerCase();
  if (lc === "") return { kind: "none" };

  // Tier 1 — exact wins, even if other items would word-segment match
  const exact = items.find(it => it.name.toLowerCase() === lc);
  if (exact) return { kind: "exact", match: exact };

  // Tier 2a — suffix-match preferred (`*-target`). Matches oracle session
  // convention `NN-<name>` where user types `<name>` and wants the session.
  const suffix = items.filter(it => it.name.toLowerCase().endsWith(`-${lc}`));
  if (suffix.length === 1) return { kind: "fuzzy", match: suffix[0]! };
  if (suffix.length >= 2) return { kind: "ambiguous", candidates: suffix };

  // Tier 2b — prefix or middle (`target-*` or `*-target-*`). Only tried
  // when there's no suffix match. Catches view/aux sessions when the user
  // is specifically looking for one.
  const prefixOrMid = items.filter(it => {
    const n = it.name.toLowerCase();
    return n.startsWith(`${lc}-`) || n.includes(`-${lc}-`);
  });
  if (prefixOrMid.length === 1) return { kind: "fuzzy", match: prefixOrMid[0]! };
  if (prefixOrMid.length >= 2) return { kind: "ambiguous", candidates: prefixOrMid };

  // Tier 3 — substring fallback. Never auto-picks, never ambiguous; only
  // populates `hints` so callers can render "did you mean?" next to the
  // not-found message. Stays under `kind: "none"` by design.
  const hints = items.filter(it => it.name.toLowerCase().includes(lc));
  if (hints.length > 0) return { kind: "none", hints };
  return { kind: "none" };
}

// Thin convenience wrappers so call sites read cleanly at the use site.
// Both are the same generic — they exist purely for intent at the call site.
export const resolveSessionTarget = resolveByName;
export const resolveWorktreeTarget = resolveByName;
