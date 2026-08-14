// Regression: repo directory names containing characters other than "/" and "."
//
// Follow-up to claude-sessions-hyphen-repo.test.ts. That fix matched in the
// ENCODE direction, which is the right direction — but the encoder itself only
// replaced [/.], while Claude Code replaces EVERY non-alphanumeric character.
//
// 🔍 Ground truth, read out of the Claude Code binary (v2.1.232, 2026-08-14):
//      function _Eo(e){return e.replace(/[^a-zA-Z0-9]/g,"-")}
//      function xE(e){let t=_Eo(e);if(t.length<=200)return t;...}
//
// This file deliberately encodes with that ground-truth rule rather than by
// calling (or mirroring) the source under test. The pre-existing test helper
// mirrors the implementation's own assumption, so it can only ever confirm
// whatever the implementation already believes — it cannot discover that the
// character class is wrong.
//
// Shapes covered here that no box on srv1809016 happens to have today, which is
// precisely why nothing caught this: "_" and a space in the directory name.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const tempDirs: string[] = [];
const originalProjectsDir = process.env.MAW_CLAUDE_PROJECTS_DIR;

function tempDir(): string {
  const dir = mkdtempSync(join(realpathSync("/tmp"), "mawnonalnum"));
  tempDirs.push(dir);
  return dir;
}

/** How Claude Code actually names the directory — NOT how maw encodes it. */
function claudeCodeEncode(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

async function freshModule(): Promise<typeof import("../src/core/fleet/claude-sessions")> {
  return import(`../src/core/fleet/claude-sessions.ts?test=${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  if (originalProjectsDir === undefined) delete process.env.MAW_CLAUDE_PROJECTS_DIR;
  else process.env.MAW_CLAUDE_PROJECTS_DIR = originalProjectsDir;
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/** Builds a fake home + projects dir with one live session, and returns the sessions. */
async function sessionsFor(repoName: string, pid: number) {
  const home = tempDir();
  const projectsRoot = join(home, ".claude", "projects");
  process.env.MAW_CLAUDE_PROJECTS_DIR = projectsRoot;

  const projectPath = join(home, "projects", repoName);
  mkdirSync(projectPath, { recursive: true });

  const claudeProjectDir = join(projectsRoot, claudeCodeEncode(projectPath));
  mkdirSync(claudeProjectDir, { recursive: true });
  const sessionFile = join(claudeProjectDir, "live.jsonl");
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "yo" }] } }),
  ].join("\n"));

  const { listClaudeSessions, __resetClaudeSessionCachesForTests } = await freshModule();
  __resetClaudeSessionCachesForTests();
  const execSync = (command: string) => {
    if (command.startsWith("ps -eo")) return `${pid} ${pid - 42} claude`;
    if (command.startsWith(`readlink /proc/${pid}/cwd`)) return `${projectPath}\n`;
    if (command.startsWith(`lsof -p ${pid}`)) return `n${projectPath}\n`;
    if (command.startsWith(`ps -o comm=,ppid= -p ${pid - 42}`)) return "tmux 1\n";
    if (command.startsWith("tail ")) return readFileSync(sessionFile, "utf-8");
    if (command.startsWith("awk ")) return "2\n";
    if (command.includes("remote get-url") || command.includes("worktree list")) {
      throw new Error("not a git repo");
    }
    throw new Error(`unexpected execSync call: ${command}`);
  };
  return { sessions: await listClaudeSessions({ execSync }), projectPath };
}

describe("repo directory names with non-alphanumeric characters", () => {
  test("underscore in the directory name still matches its pid", async () => {
    const { sessions, projectPath } = await sessionsFor("volt_oracle", 5151);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pid).toBe(5151);              // was null with the [/.] encoder
    expect(sessions[0].status).toBe("active");       // was "ended"
    expect(sessions[0].projectPath).toBe(projectPath);
  });

  test("space in the directory name still matches its pid", async () => {
    const { sessions, projectPath } = await sessionsFor("my repo", 5252);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pid).toBe(5252);
    expect(sessions[0].projectPath).toBe(projectPath);
  });

  test("the encoder matches Claude Code's rule character-for-character", async () => {
    const { encodeProjectDir } = await freshModule();
    // every sample is a path shape that has actually appeared on some oracle box,
    // plus the shapes that used to slip through
    for (
      const p of [
        "/root",
        "/root/projects/volt-oracle",
        "/root/ghq/github.com/natman95/arc-oracle",
        "/root/projects/volt_oracle",
        "/root/projects/my repo",
        "/root/projects/v1.2_beta-x",
      ]
    ) {
      expect(encodeProjectDir(p)).toBe(claudeCodeEncode(p));
    }
  });

  test("hyphen and dot keep working (no regression on the previously fixed shapes)", async () => {
    const { sessions } = await sessionsFor("volt-oracle", 5353);
    expect(sessions[0].pid).toBe(5353);
  });
});
