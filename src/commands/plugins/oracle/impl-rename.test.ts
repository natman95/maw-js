import { describe, expect, test } from "bun:test";
import { encodePath, validateRename, computeRenamePlan } from "./impl-rename";

describe("encodePath — Claude Code project dir encoding", () => {
  test("absolute path becomes dash-prefixed dash-separated", () => {
    const enc = encodePath("/Users/nat/Code/github.com/Soul-Brews-Studio/discord-oracle");
    expect(enc).toBe("-Users-nat-Code-github-com-Soul-Brews-Studio-discord-oracle");
  });

  test("dots become dashes (github.com → github-com)", () => {
    expect(encodePath("/x.y.z")).toBe("-x-y-z");
  });

  test("slashes become dashes", () => {
    expect(encodePath("/a/b/c")).toBe("-a-b-c");
  });

  test("matches the manual rename proof (sage-vector-fix → arra-mcp-installation-guide)", () => {
    const oldEnc = encodePath("/Users/nat/Code/github.com/Soul-Brews-Studio/sage-vector-fix-oracle");
    const newEnc = encodePath("/Users/nat/Code/github.com/Soul-Brews-Studio/arra-mcp-installation-guide-oracle");
    expect(oldEnc).toBe("-Users-nat-Code-github-com-Soul-Brews-Studio-sage-vector-fix-oracle");
    expect(newEnc).toBe("-Users-nat-Code-github-com-Soul-Brews-Studio-arra-mcp-installation-guide-oracle");
  });

  test("matches Claude Code's own encoding (validates against actual ~/.claude/projects/)", () => {
    // This is the encoding Claude Code uses for project dirs in ~/.claude/projects/
    const enc = encodePath("/Users/nat/Code/github.com/Soul-Brews-Studio/maw-js");
    expect(enc).toBe("-Users-nat-Code-github-com-Soul-Brews-Studio-maw-js");
  });
});

describe("validateRename", () => {
  test("returns null for valid rename", () => {
    expect(validateRename("foo", "bar")).toBe(null);
  });

  test("rejects identical names", () => {
    expect(validateRename("foo", "foo")).toMatch(/identical/);
  });

  test("rejects new name with uppercase", () => {
    expect(validateRename("foo", "Bar")).toMatch(/must match/);
  });

  test("rejects new name with underscores", () => {
    expect(validateRename("foo", "bar_baz")).toMatch(/must match/);
  });

  test("rejects new name with spaces", () => {
    expect(validateRename("foo", "bar baz")).toMatch(/must match/);
  });

  test("rejects empty old name", () => {
    expect(validateRename("", "bar")).toMatch(/old name required/);
  });

  test("accepts hyphens and digits", () => {
    expect(validateRename("foo", "bar-123-baz")).toBe(null);
  });
});

describe("computeRenamePlan", () => {
  test("constructs all 6 paths from oldName/newName/org/home", () => {
    const plan = computeRenamePlan("foo", "bar", "Acme", "/home/u");
    expect(plan.oldRepoPath).toBe("/home/u/Code/github.com/Acme/foo-oracle");
    expect(plan.newRepoPath).toBe("/home/u/Code/github.com/Acme/bar-oracle");
    expect(plan.oldEncoded).toBe("-home-u-Code-github-com-Acme-foo-oracle");
    expect(plan.newEncoded).toBe("-home-u-Code-github-com-Acme-bar-oracle");
    expect(plan.oldProjectDir).toBe("/home/u/.claude/projects/-home-u-Code-github-com-Acme-foo-oracle");
    expect(plan.newProjectDir).toBe("/home/u/.claude/projects/-home-u-Code-github-com-Acme-bar-oracle");
    expect(plan.oldRepoSlug).toBe("Acme/foo-oracle");
    expect(plan.newRepoSlug).toBe("Acme/bar-oracle");
  });

  test("matches the proven manual rename (sage-vector-fix → arra-mcp-installation-guide)", () => {
    const plan = computeRenamePlan(
      "sage-vector-fix",
      "arra-mcp-installation-guide",
      "Soul-Brews-Studio",
      "/Users/nat",
    );
    expect(plan.oldRepoSlug).toBe("Soul-Brews-Studio/sage-vector-fix-oracle");
    expect(plan.newRepoSlug).toBe("Soul-Brews-Studio/arra-mcp-installation-guide-oracle");
    expect(plan.oldProjectDir).toContain("sage-vector-fix-oracle");
    expect(plan.newProjectDir).toContain("arra-mcp-installation-guide-oracle");
  });
});
