import { describe, test, expect } from "bun:test";
import { buildTargets, mirrorCmd, pickLayout } from "../src/overview";
import type { Session } from "../src/ssh";

const MOCK_SESSIONS: Session[] = [
  {
    name: "1-neo",
    windows: [
      { index: 1, name: "claude", active: true },
      { index: 2, name: "editor", active: false },
    ],
  },
  {
    name: "2-hermes",
    windows: [
      { index: 1, name: "claude", active: false },
      { index: 2, name: "shell", active: true },
    ],
  },
  {
    name: "3-pulse",
    windows: [{ index: 1, name: "claude", active: true }],
  },
  {
    name: "0-overview",
    windows: [{ index: 1, name: "war-room", active: true }],
  },
  {
    name: "scratch",
    windows: [{ index: 1, name: "misc", active: true }],
  },
];

describe("buildTargets", () => {
  test("finds all numbered sessions except 0-overview", () => {
    const targets = buildTargets(MOCK_SESSIONS, []);
    expect(targets).toHaveLength(3);
    expect(targets.map(t => t.oracle)).toEqual(["neo", "hermes", "pulse"]);
  });

  test("excludes 0-overview session", () => {
    const targets = buildTargets(MOCK_SESSIONS, []);
    expect(targets.find(t => t.oracle === "overview")).toBeUndefined();
  });

  test("excludes non-numbered sessions", () => {
    const targets = buildTargets(MOCK_SESSIONS, []);
    expect(targets.find(t => t.session === "scratch")).toBeUndefined();
  });

  test("picks active window index", () => {
    const targets = buildTargets(MOCK_SESSIONS, []);
    expect(targets.find(t => t.oracle === "neo")!.window).toBe(1);
    expect(targets.find(t => t.oracle === "hermes")!.window).toBe(2);
  });

  test("strips number prefix for oracle name", () => {
    const targets = buildTargets(MOCK_SESSIONS, []);
    expect(targets[0].oracle).toBe("neo");
    expect(targets[0].session).toBe("1-neo");
  });

  test("filters by oracle name", () => {
    const targets = buildTargets(MOCK_SESSIONS, ["neo"]);
    expect(targets).toHaveLength(1);
    expect(targets[0].oracle).toBe("neo");
  });

  test("filters by partial oracle name", () => {
    const targets = buildTargets(MOCK_SESSIONS, ["her"]);
    expect(targets).toHaveLength(1);
    expect(targets[0].oracle).toBe("hermes");
  });

  test("filters by session name", () => {
    const targets = buildTargets(MOCK_SESSIONS, ["1-neo"]);
    expect(targets).toHaveLength(1);
    expect(targets[0].oracle).toBe("neo");
  });

  test("multiple filters are OR'd", () => {
    const targets = buildTargets(MOCK_SESSIONS, ["neo", "pulse"]);
    expect(targets).toHaveLength(2);
    expect(targets.map(t => t.oracle)).toEqual(["neo", "pulse"]);
  });

  test("no match returns empty", () => {
    const targets = buildTargets(MOCK_SESSIONS, ["nonexistent"]);
    expect(targets).toHaveLength(0);
  });

  test("handles session with no active window", () => {
    const sessions: Session[] = [
      {
        name: "5-volt",
        windows: [
          { index: 1, name: "shell", active: false },
          { index: 2, name: "editor", active: false },
        ],
      },
    ];
    const targets = buildTargets(sessions, []);
    expect(targets[0].window).toBe(1);
  });

  test("handles session with no windows", () => {
    const sessions: Session[] = [
      { name: "5-volt", windows: [] },
    ];
    const targets = buildTargets(sessions, []);
    expect(targets[0].window).toBe(1);
  });
});

describe("mirrorCmd", () => {
  test("includes oracle name and target in label", () => {
    const cmd = mirrorCmd({ session: "1-neo", window: 1, oracle: "neo" });
    expect(cmd).toContain("neo (1-neo:1)");
  });

  test("calls maw peek with oracle name", () => {
    const cmd = mirrorCmd({ session: "2-hermes", window: 2, oracle: "hermes" });
    expect(cmd).toContain("maw peek hermes");
  });

  test("is a while-true loop with sleep", () => {
    const cmd = mirrorCmd({ session: "1-neo", window: 1, oracle: "neo" });
    expect(cmd).toMatch(/^while true;/);
    expect(cmd).toContain("sleep 0.5");
  });
});

describe("pickLayout", () => {
  test("uses even-horizontal for 1-3 targets", () => {
    expect(pickLayout(1)).toBe("even-horizontal");
    expect(pickLayout(2)).toBe("even-horizontal");
    expect(pickLayout(3)).toBe("even-horizontal");
  });

  test("uses tiled for 4+ targets", () => {
    expect(pickLayout(4)).toBe("tiled");
    expect(pickLayout(5)).toBe("tiled");
    expect(pickLayout(10)).toBe("tiled");
  });
});

describe("argument parsing", () => {
  test("separates flags from filter args", () => {
    const filterArgs = ["neo", "--kill", "hermes", "-k"];
    const kill = filterArgs.includes("--kill") || filterArgs.includes("-k");
    const filters = filterArgs.filter(a => !a.startsWith("-"));
    expect(kill).toBe(true);
    expect(filters).toEqual(["neo", "hermes"]);
  });

  test("no flags means no kill", () => {
    const filterArgs = ["neo", "hermes"];
    const kill = filterArgs.includes("--kill") || filterArgs.includes("-k");
    expect(kill).toBe(false);
  });

  test("empty args", () => {
    const filterArgs: string[] = [];
    const kill = filterArgs.includes("--kill") || filterArgs.includes("-k");
    const filters = filterArgs.filter(a => !a.startsWith("-"));
    expect(kill).toBe(false);
    expect(filters).toEqual([]);
  });
});
