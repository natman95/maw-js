/**
 * route-comm-send.test.ts — #1388 regression guard.
 *
 * Top-level `maw send` is message delivery, not raw pane typing. It must
 * route through the same core cmdSend path as `maw hey`, which appends Enter
 * through the transport and reports `delivered` instead of leaving text in the
 * target prompt buffer.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

const calls: unknown[][] = [];
const peekCalls: unknown[][] = [];
const logs: string[] = [];
const errors: string[] = [];

mock.module("../../src/commands/shared/comm", () => ({
  cmdSend: async (...args: unknown[]) => { calls.push(args); },
  cmdPeek: async (...args: unknown[]) => { peekCalls.push(args); },
}));

const origLog = console.log;
const origError = console.error;
console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };

const { routeComm } = await import("../../src/cli/route-comm");

afterAll(() => { console.log = origLog; console.error = origError; });

beforeEach(() => {
  calls.length = 0;
  peekCalls.length = 0;
  logs.length = 0;
  errors.length = 0;
});

describe("routeComm — top-level send uses core delivery (#1388)", () => {
  test("maw send <target> <message> routes through cmdSend like maw hey", async () => {
    const handled = await routeComm("send", ["send", "local:mawjs", "hello", "world"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "hello world", false, { approve: false, trust: false, inboxOnly: false }],
    ]);
  });

  test("--force is preserved as deprecated compatibility and stripped from the delivered message", async () => {
    const handled = await routeComm("send", ["send", "local:mawjs", "hello", "--force"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "hello", true, { approve: false, trust: false, inboxOnly: false }],
    ]);
    expect(errors.join("\n")).toContain("--force is deprecated");
  });

  test("--inbox is stripped from the delivered message and opts out of pane injection", async () => {
    const handled = await routeComm("hey", ["hey", "local:mawjs", "hello", "--inbox"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "hello", false, { approve: false, trust: false, inboxOnly: true }],
    ]);
  });

  test("maw hey remains on the same core path", async () => {
    const handled = await routeComm("hey", ["hey", "local:mawjs", "ping"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "ping", false, { approve: false, trust: false, inboxOnly: false }],
    ]);
  });

  test("maw send --help prints usage instead of treating --help as a target (#1531)", async () => {
    const handled = await routeComm("send", ["send", "--help"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toContain("usage: maw send <target> <message>");
    expect(logs.join("\n")).toContain("local:<agent>");
  });

  test("maw hey -h prints usage instead of treating -h as a target (#1531)", async () => {
    const handled = await routeComm("hey", ["hey", "-h"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toContain("usage: maw hey <target> <message>");
  });

  test("--approve/--trust are stripped from the delivered message and passed as delivery opts", async () => {
    const handled = await routeComm("hey", ["hey", "local:mawjs", "hello", "--approve", "--trust"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "hello", false, { approve: true, trust: true, inboxOnly: false }],
    ]);
  });

  test("missing target prints usage to stderr and throws a UserError", async () => {
    await expect(routeComm("send", ["send"])).rejects.toThrow("missing target and message");

    expect(calls).toEqual([]);
    expect(errors.join("\n")).toContain("usage: maw send <target> <message>");
  });

  test("missing message names the target and throws a UserError", async () => {
    await expect(routeComm("hey", ["hey", "local:mawjs"])).rejects.toThrow("missing message for 'local:mawjs'");

    expect(calls).toEqual([]);
    const text = errors.join("\n");
    expect(text).toContain("✗ missing message for target 'local:mawjs'");
    expect(text).toContain("maw hey local:mawjs <message>");
  });

  test("non-comm commands are not handled", async () => {
    await expect(routeComm("wake", ["wake", "mawjs"])).resolves.toBe(false);
    expect(calls).toEqual([]);
    expect(peekCalls).toEqual([]);
  });

  test("maw peek routes through federation-aware cmdPeek, not tmux alias", async () => {
    const handled = await routeComm("peek", ["peek", "m5:mawjs"]);

    expect(handled).toBe(true);
    expect(peekCalls).toEqual([["m5:mawjs"]]);
    expect(calls).toEqual([]);
  });
});

/**
 * #maw-hey-flag-guard — an unknown flag must be REFUSED, not delivered as message text.
 *
 * Before the guard: any token that matched none of the known flags fell through the
 * `.filter()` and became message content, while maw printed `delivered` and returned rc=0.
 * `maw hey morse --file /path/msg.md` reached the receiver as one line reading
 * `--file /path/msg.md`, and nothing on either side reported a problem.
 * 📎 Volt hit it 3 times in 4 days (srv1809016); morse named the class: fail-open.
 */
describe("routeComm — an unknown flag is refused, not turned into the message", () => {
  test("unknown flag after the target throws and sends nothing", async () => {
    await expect(routeComm("hey", ["hey", "local:mawjs", "--file", "/tmp/msg.md"]))
      .rejects.toThrow("unknown flag: --file");
    expect(calls).toEqual([]);
    expect(errors.join("\n")).toContain("unknown flag: --file");
  });

  test("-- ends the flags, so a message may start with a double dash", async () => {
    const handled = await routeComm("hey", ["hey", "local:mawjs", "--", "--file", "/tmp/msg.md"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "--file /tmp/msg.md", false, { approve: false, trust: false, inboxOnly: false }],
    ]);
  });

  // 🔴 near-miss lifted from real traffic (3,913 delivered lines swept on node white):
  //    `---` opens YAML frontmatter and 4 real documents were sent that way
  //    (morse 2 · volt 1 · echo 1). A guard keyed on `startsWith("--")` would refuse all
  //    four. This case is the only thing stopping someone widening it back — do not delete.
  test("a document beginning with --- (frontmatter) must still send", async () => {
    const doc = "---\nfrom: volt\nto: morse\n---\n\nbody";
    const handled = await routeComm("hey", ["hey", "local:mawjs", doc]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", doc, false, { approve: false, trust: false, inboxOnly: false }],
    ]);
  });

  // negative control — the guard must not be too wide: a `--word` AFTER the message has
  // started is part of the sentence, not a flag. Behaviour must be unchanged.
  test("a --word in mid-sentence still sends unchanged", async () => {
    const handled = await routeComm("hey", ["hey", "local:mawjs", "hello", "--world"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "hello --world", false, { approve: false, trust: false, inboxOnly: false }],
    ]);
  });

  // negative control — known flags keep working exactly as before, in any position after
  // the target, and never reach the message body.
  test("known flags are still consumed, not refused and not delivered", async () => {
    const handled = await routeComm("hey", ["hey", "local:mawjs", "--inbox", "hello", "--approve"]);

    expect(handled).toBe(true);
    expect(calls).toEqual([
      ["local:mawjs", "hello", false, { approve: true, trust: false, inboxOnly: true }],
    ]);
  });
});
