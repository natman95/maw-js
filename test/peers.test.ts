import { describe, test, expect, mock, beforeEach } from "bun:test";
// Import the real D defaults BEFORE mocking the module, so our mock can
// delegate cfgInterval/cfgTimeout/cfgLimit to the real defaults. This keeps
// transitively-loaded modules (tmux.ts uses cfgLimit) working when this
// test file runs before theirs and the mock persists in the module cache.
import { D as RealD } from "../src/config";

// Mock config so getPeers() reads fixtures, not the real ~/.config/maw/maw.config.json.
// getPeers() only calls loadConfig() — no network side effects — so we don't need
// to mock curl-fetch (and mocking it globally would leak into curl-fetch.test.ts).
let mockConfig: any = {};
mock.module("../src/config", () => ({
  loadConfig: () => mockConfig,
  resetConfig: () => {},
  cfg: (key: string) => (mockConfig as any)[key],
  cfgInterval: (key: keyof typeof RealD.intervals) => RealD.intervals[key],
  cfgTimeout: (key: keyof typeof RealD.timeouts) => RealD.timeouts[key],
  cfgLimit: (key: keyof typeof RealD.limits) => RealD.limits[key],
  D: RealD,
}));

const { getPeers } = await import("../src/peers");

describe("getPeers — merges peers[] and namedPeers[]", () => {
  beforeEach(() => {
    mockConfig = {};
  });

  test("empty config → empty array", () => {
    mockConfig = {};
    expect(getPeers()).toEqual([]);
  });

  test("only peers[] → returns flat list unchanged", () => {
    mockConfig = { peers: ["http://a.wg:3456", "http://b.wg:3456"] };
    expect(getPeers()).toEqual(["http://a.wg:3456", "http://b.wg:3456"]);
  });

  test("only namedPeers[] → returns URLs from named entries", () => {
    mockConfig = {
      namedPeers: [
        { name: "mba", url: "http://mba.wg:3457" },
        { name: "clinic", url: "http://clinic.wg:3457" },
      ],
    };
    expect(getPeers()).toEqual(["http://mba.wg:3457", "http://clinic.wg:3457"]);
  });

  test("both peers[] and namedPeers[] → merged, peers[] first", () => {
    mockConfig = {
      peers: ["http://old.wg:3456"],
      namedPeers: [
        { name: "mba", url: "http://mba.wg:3457" },
        { name: "clinic", url: "http://clinic.wg:3457" },
      ],
    };
    expect(getPeers()).toEqual([
      "http://old.wg:3456",
      "http://mba.wg:3457",
      "http://clinic.wg:3457",
    ]);
  });

  test("duplicate URL in peers[] and namedPeers[] → deduped, peers[] wins", () => {
    mockConfig = {
      peers: ["http://mba.wg:3457"],
      namedPeers: [
        { name: "mba", url: "http://mba.wg:3457" },
        { name: "clinic", url: "http://clinic.wg:3457" },
      ],
    };
    const result = getPeers();
    expect(result).toEqual(["http://mba.wg:3457", "http://clinic.wg:3457"]);
    expect(result.length).toBe(2); // no duplicate
  });

  test("duplicate URL across multiple namedPeers → deduped", () => {
    mockConfig = {
      namedPeers: [
        { name: "mba-alias-1", url: "http://mba.wg:3457" },
        { name: "mba-alias-2", url: "http://mba.wg:3457" },
      ],
    };
    expect(getPeers()).toEqual(["http://mba.wg:3457"]);
  });

  test("triangle federation config → 2 peers visible (fix for #bug)", () => {
    // This is the exact shape that was broken before:
    // white's maw.config.json with only namedPeers entries, no peers[].
    // Before the fix, getPeers() returned [] and federation status showed
    // "0 peers configured" even though white is wired to mba + clinic.
    mockConfig = {
      node: "white",
      port: 3456,
      namedPeers: [
        { name: "mba", url: "http://mba.wg:3457" },
        { name: "clinic", url: "http://clinic.wg:3457" },
      ],
    };
    const result = getPeers();
    expect(result.length).toBe(2);
    expect(result).toContain("http://mba.wg:3457");
    expect(result).toContain("http://clinic.wg:3457");
  });
});
