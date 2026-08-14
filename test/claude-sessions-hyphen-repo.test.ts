// Regression: a repo directory whose NAME contains a hyphen ("volt-oracle").
//
// Claude's project-dir encoding maps BOTH "/" and "-" to "-", so decoding is
// lossy: "-root-projects-volt-oracle" decodes to "/root/projects/volt/oracle",
// a path that does not exist. Matching a running process by that decoded path
// therefore never hits, and every live session is reported pid:null/"ended".
//
// Observed on srv1809016 2026-08-14: all three oracles (volt, arc, morse) —
// every repo name hyphenated — showed "0 claude" in the dashboard while all
// three were running. The pre-existing tests could not catch it: their fixture
// repo is named "mawrepo" (no hyphen, no dot), the one shape that round-trips.
//
// The fix matches in the ENCODE direction, which is exact.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const tempDirs: string[] = [];
const originalProjectsDir = process.env.MAW_CLAUDE_PROJECTS_DIR;

function tempDir(): string {
  const dir = mkdtempSync(join(realpathSync("/tmp"), "mawhyphenrepo"));
  tempDirs.push(dir);
  return dir;
}
function encodeProjectPath(path: string): string {
  return path.replace(/^\//, "-").replace(/[/.]/g, "-");
}
async function freshModule(): Promise<typeof import("../src/core/fleet/claude-sessions")> {
  return import(`../src/core/fleet/claude-sessions.ts?test=${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  if (originalProjectsDir === undefined) delete process.env.MAW_CLAUDE_PROJECTS_DIR;
  else process.env.MAW_CLAUDE_PROJECTS_DIR = originalProjectsDir;
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("hyphenated repo directory", () => {
  test("a running claude in /…/volt-oracle is matched to its pid, not reported as ended", async () => {
    const home = tempDir();
    const projectsRoot = join(home, ".claude", "projects");
    process.env.MAW_CLAUDE_PROJECTS_DIR = projectsRoot;

    // the shape that breaks: a hyphen inside the directory NAME
    const projectPath = join(home, "projects", "volt-oracle");
    mkdirSync(projectPath, { recursive: true });

    const encoded = encodeProjectPath(projectPath);
    const claudeProjectDir = join(projectsRoot, encoded);
    mkdirSync(claudeProjectDir, { recursive: true });
    const sessionFile = join(claudeProjectDir, "live.jsonl");
    writeFileSync(sessionFile, [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "yo" }] } }),
    ].join("\n"));

    const { listClaudeSessions, __resetClaudeSessionCachesForTests } = await freshModule();
    __resetClaudeSessionCachesForTests();
    const execSync = (command: string) => {
      if (command.startsWith("ps -eo")) return `4242 4200 claude`;
      if (command.startsWith("readlink /proc/4242/cwd")) return `${projectPath}\n`;
      if (command.startsWith("lsof -p 4242")) return `n${projectPath}\n`;
      if (command.startsWith("ps -o comm=,ppid= -p 4200")) return "tmux 1\n";
      if (command.startsWith("tail ")) return readFileSync(sessionFile, "utf-8");
      if (command.startsWith("awk ")) return "2\n";
      if (command.includes("remote get-url") || command.includes("worktree list")) throw new Error("not a git repo");
      throw new Error(`unexpected execSync call: ${command}`);
    };

    const sessions = await listClaudeSessions({ execSync });
    expect(sessions).toHaveLength(1);
    // the three assertions the old code fails
    expect(sessions[0].pid).toBe(4242);          // was null
    expect(sessions[0].status).toBe("active");   // was "ended"
    expect(sessions[0].projectPath).toBe(projectPath); // was "…/projects/volt/oracle"
  });

  test("a hyphen-free repo still round-trips (no regression for the old path)", async () => {
    const home = tempDir();
    const projectsRoot = join(home, ".claude", "projects");
    process.env.MAW_CLAUDE_PROJECTS_DIR = projectsRoot;
    const projectPath = join(home, "projects", "mawrepo");
    mkdirSync(projectPath, { recursive: true });
    const claudeProjectDir = join(projectsRoot, encodeProjectPath(projectPath));
    mkdirSync(claudeProjectDir, { recursive: true });
    const sessionFile = join(claudeProjectDir, "live.jsonl");
    writeFileSync(sessionFile, JSON.stringify({ type: "user", message: { content: "hi" } }));

    const { listClaudeSessions, __resetClaudeSessionCachesForTests } = await freshModule();
    __resetClaudeSessionCachesForTests();
    const execSync = (command: string) => {
      if (command.startsWith("ps -eo")) return `77 70 claude`;
      if (command.startsWith("readlink /proc/77/cwd")) return `${projectPath}\n`;
      if (command.startsWith("lsof -p 77")) return `n${projectPath}\n`;
      if (command.startsWith("ps -o comm=,ppid= -p 70")) return "tmux 1\n";
      if (command.startsWith("tail ")) return readFileSync(sessionFile, "utf-8");
      if (command.startsWith("awk ")) return "1\n";
      if (command.includes("remote get-url") || command.includes("worktree list")) throw new Error("not a git repo");
      throw new Error(`unexpected execSync call: ${command}`);
    };
    const sessions = await listClaudeSessions({ execSync });
    expect(sessions[0].pid).toBe(77);
    expect(sessions[0].projectPath).toBe(projectPath);
  });
});
