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

  test("rename every window to `claude` and all three houses still resolve", () => {
    // The whole box in the state tmux would leave it: not one usable window
    // name anywhere. Session names must carry it alone.
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

  test("identity carried ONLY by the window still counts as live", () => {
    // The half this fix must not break, and the first version of it did.
    // `session` says nothing about who lives there; `live-oracle` is the only
    // place the oracle name appears. Resolving by session name alone would
    // call this house dead — moving the false negative rather than deleting
    // it, onto a shape that exists in this codebase today.
    const identityInWindow = [{ name: "session", windows: [{ name: "live-oracle" }] }];
    expect(isOracleLiveLocally("live", identityInWindow)).toBe(true);
  });

  test("the session-name path only ever adds liveness — it never takes it away", () => {
    // Union invariant: anything the old window-name rule called live must
    // still be live. Being wrongly called dead is what spawns a duplicate, so
    // regressions in that direction are the dangerous ones.
    const oldRuleSaidLive = [
      { name: "whatever", windows: [{ name: "nari-oracle" }] },
      { name: "another", windows: [{ name: "pulse" }] },
    ];
    expect(isOracleLiveLocally("nari", oldRuleSaidLive)).toBe(true);
    expect(isOracleLiveLocally("pulse", oldRuleSaidLive)).toBe(true);
  });

  test("an empty agent name never matches everything", () => {
    expect(isOracleLiveLocally("", BOX)).toBe(false);
  });
});
