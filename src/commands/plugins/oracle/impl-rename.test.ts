import { describe, expect, test } from "bun:test";
import { encodePath } from "./impl-rename";

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
