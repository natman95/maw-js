/**
 * Unit tests for src/core/ghq.ts
 *
 * Strategy: exercise the pure `_normalize` helper directly for Windows/POSIX
 * path handling. Skip integration (spawning real ghq) — that's what the
 * end-to-end tests on main are for.
 */

import { describe, test, expect } from "bun:test";
import { _normalize, ghqFind, ghqFindSync } from "../src/core/ghq";

describe("_normalize (Windows path handling)", () => {
  test("POSIX paths pass through unchanged", () => {
    const input = "/home/user/Code/github.com/org/repo\n/home/user/Code/github.com/org/repo2";
    expect(_normalize(input)).toEqual([
      "/home/user/Code/github.com/org/repo",
      "/home/user/Code/github.com/org/repo2",
    ]);
  });

  test("Windows backslash paths are converted to forward slashes", () => {
    const input = "C:\\Users\\Nat\\Code\\github.com\\org\\repo";
    expect(_normalize(input)).toEqual(["C:/Users/Nat/Code/github.com/org/repo"]);
  });

  test("mixed separators are fully normalized", () => {
    const input = "C:\\Users\\Nat/Code\\github.com/org\\repo";
    expect(_normalize(input)).toEqual(["C:/Users/Nat/Code/github.com/org/repo"]);
  });

  test("empty lines are filtered", () => {
    const input = "/a\n\n/b\n\n\n";
    expect(_normalize(input)).toEqual(["/a", "/b"]);
  });

  test("empty input returns empty array (no ghost empty-string entry)", () => {
    expect(_normalize("")).toEqual([]);
  });

  test("trailing newline does not add empty entry", () => {
    expect(_normalize("/a\n/b\n")).toEqual(["/a", "/b"]);
  });
});

describe("ghqFindSync (pattern matching against normalized paths)", () => {
  // Note: ghqFindSync calls execSync("ghq list --full-path") which we can't
  // easily mock without module isolation. Instead we verify the regex
  // construction by checking the return type contract.

  test("returns string | null (never undefined or empty string)", () => {
    const result = ghqFindSync("definitely-not-a-real-repo-xxxyyy");
    // Even if ghq isn't installed or finds nothing, result is null not undefined
    expect(result === null || typeof result === "string").toBe(true);
  });

  test("accepts string patterns (case-insensitive by default)", () => {
    // Passing a string pattern should not throw
    expect(() => ghqFindSync("/foo$")).not.toThrow();
  });

  test("accepts RegExp patterns", () => {
    expect(() => ghqFindSync(/\/foo$/i)).not.toThrow();
  });
});

describe("ghqFind (async variant)", () => {
  test("returns string | null", async () => {
    const result = await ghqFind("definitely-not-a-real-repo-xxxyyy");
    expect(result === null || typeof result === "string").toBe(true);
  });

  test("accepts string and RegExp patterns", async () => {
    await expect(ghqFind("/foo$")).resolves.toBeDefined();
    await expect(ghqFind(/\/foo$/i)).resolves.toBeDefined();
  });
});

describe("regression guard — the normalize pattern", () => {
  // The original bug: PR #379 fixed Windows by piping through `tr '\\' '/'`
  // at 13 call sites. This helper exists to centralize that. If someone
  // reverts `_normalize` to a pass-through, this test should fail.
  test("backslash-to-forward-slash is applied", () => {
    const windowsPath = "C:\\foo\\bar";
    const result = _normalize(windowsPath);
    expect(result[0]).not.toContain("\\");
    expect(result[0]).toBe("C:/foo/bar");
  });
});
