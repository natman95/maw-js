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
 * Three-tier cascade:
 *
 * 1. **exact** (case-insensitive): name === target → { kind: "exact" }.
 * 2. **word-segment**: dash-bounded anywhere in the name — prefix
 *    (`target-*`), suffix (`*-target`), or middle (`*-target-*`). 1 match →
 *    "fuzzy" (auto-pick). 2+ matches → "ambiguous" (caller disambiguates).
 * 3. **substring fallback** (only if tier 2 was empty): `name.includes(target)`
 *    anywhere. Matches are returned as `hints` under `kind: "none"` — they
 *    never auto-pick and never become ambiguous. Callers can render
 *    "did you mean?" but the contract still says "not found".
 *
 * Invariant: the match ladder is exact → word-segment → none. Substring
 * matches are auxiliary hints, never a real match. This keeps resolution
 * predictable: a bare name either resolves cleanly or the caller refuses.
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

  // Tier 2 — word-segment: dash-bounded prefix, suffix, or middle
  const segment = items.filter(it => {
    const n = it.name.toLowerCase();
    return (
      n.startsWith(`${lc}-`) ||
      n.endsWith(`-${lc}`) ||
      n.includes(`-${lc}-`)
    );
  });
  if (segment.length === 1) return { kind: "fuzzy", match: segment[0]! };
  if (segment.length >= 2) return { kind: "ambiguous", candidates: segment };

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
