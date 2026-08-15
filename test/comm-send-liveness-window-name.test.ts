/**
 * Liveness must survive tmux renaming the window.
 *
 * Regression guard for the 2026-08-15 duplicate-oracle incident on
 * srv1809016. `maw hey arc` decided arc was dead, auto-woke it, and spawned a
 * second claude that forked arc's context and marked two of his inbox letters
 * read before he ever saw them.
 *
 * Nothing was wrong with arc. tmux had renamed his window: `automatic-rename`
 * is a `-gw` window option that defaults to on, and it rewrites any window
 * born without `-n` to the name of the running command. arc's window was
 * created unnamed, so it read `claude`, and the old predicate looked for a
 * window named exactly `arc-oracle` or `arc`.
 *
 * The loop that made it un-fixable: the duplicate window auto-wake created was
 * itself named `arc-oracle`, which made the house look live again — so closing
 * the duplicate (the obvious fix) removed the only thing satisfying the check
 * and the next message spawned another one.
 *
 * These cases use the real session shapes from that box. No mocks: the bug was
 * a fact about what tmux writes into a window name, and a fake that hands back
 * tidy names cannot reproduce it.
 */
import { describe, expect, test } from "bun:test";
import { isOracleLiveLocally } from "../src/commands/shared/comm-send";

/** Exactly what `tmux list-sessions` reported on srv1809016 at 15:40 +07. */
const BOX = [
  { name: "01-arc", windows: [{ name: "claude" }] },
  { name: "02-morse", windows: [{ name: "morse-oracle" }] },
  { name: "volt", windows: [{ name: "volt-oracle" }] },
];

describe("local liveness does not depend on the tmux window name", () => {
  test("a live NN-<oracle> session counts as live even when tmux renamed its window to the running command", () => {
    // The incident itself: window says "claude", session says 01-arc.
    expect(isOracleLiveLocally("arc", BOX)).toBe(true);
  });

  test("every house on the box resolves, regardless of how its window happens to be named", () => {
    // morse survived the original bug only because his window kept its name,
    // and volt only because its session name happens to equal the agent name.
    // Neither reason should be load-bearing.
    for (const agent of ["arc", "morse", "volt"]) {
      expect(isOracleLiveLocally(agent, BOX)).toBe(true);
    }
  });

  test("window names alone cannot carry liveness — strip them and nothing changes", () => {
    const nameless = BOX.map(s => ({ name: s.name, windows: [{ name: "claude" }] }));
    for (const agent of ["arc", "morse", "volt"]) {
      expect(isOracleLiveLocally(agent, nameless)).toBe(true);
    }
  });

  test("an oracle with no session is still reported dead, so a real wake is not suppressed", () => {
    // The fix must not make everything look alive: that would break waking.
    expect(isOracleLiveLocally("nari", BOX)).toBe(false);
    expect(isOracleLiveLocally("arc", [])).toBe(false);
  });

  test("a window named after the agent does not resurrect a house whose session is gone", () => {
    // Guards the inverse of the old rule: a stray window called `arc-oracle`
    // inside somebody else's session must not count as arc being alive.
    const strayWindowOnly = [{ name: "99-unrelated", windows: [{ name: "arc-oracle" }] }];
    expect(isOracleLiveLocally("arc", strayWindowOnly)).toBe(false);
  });

  test("an empty agent name never matches everything", () => {
    expect(isOracleLiveLocally("", BOX)).toBe(false);
  });
});
