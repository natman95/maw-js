import { hostExec } from "../ssh";
import { tmux } from "../tmux";
import { loadConfig, getEnvVars } from "../config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { FLEET_DIR } from "../paths";
import { curlFetch } from "../curl-fetch";

/** Fetch a GitHub issue and build a prompt for claude -p */
export async function fetchIssuePrompt(issueNum: number, repo?: string): Promise<string> {
  let repoSlug = repo;
  if (!repoSlug) {
    try {
      const remote = await hostExec("git remote get-url origin 2>/dev/null");
      const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (m) repoSlug = m[1];
    } catch { /* expected */ }
  }
  if (!repoSlug) throw new Error("Could not detect repo — pass --repo org/name");

  const json = await hostExec(`gh issue view ${issueNum} --repo '${repoSlug}' --json title,body,labels`);
  const issue = JSON.parse(json);
  const labels = (issue.labels || []).map((l: any) => l.name).join(", ");
  return [
    `Work on issue #${issueNum}: ${issue.title}`,
    labels ? `Labels: ${labels}` : "",
    "",
    issue.body || "(no description)",
  ].filter(Boolean).join("\n");
}

export async function resolveOracle(oracle: string): Promise<{ repoPath: string; repoName: string; parentDir: string }> {
  const ghqOut = await hostExec(`ghq list --full-path | grep -i '/${oracle}-oracle$' | head -1`);
  if (ghqOut?.trim()) {
    const repoPath = ghqOut.trim();
    return { repoPath, repoName: repoPath.split("/").pop()!, parentDir: repoPath.replace(/\/[^/]+$/, "") };
  }

  try {
    for (const file of readdirSync(FLEET_DIR).filter(f => f.endsWith(".json"))) {
      const config = JSON.parse(readFileSync(join(FLEET_DIR, file), "utf-8"));
      const win = (config.windows || []).find((w: any) => w.name === `${oracle}-oracle`);
      if (win?.repo) {
        const fullPath = await hostExec(`ghq list --full-path | grep -i '/${win.repo.replace(/^[^/]+\//, "")}$' | head -1`);
        if (fullPath?.trim()) {
          const repoPath = fullPath.trim();
          return { repoPath, repoName: repoPath.split("/").pop()!, parentDir: repoPath.replace(/\/[^/]+$/, "") };
        }
      }
    }
  } catch { /* fleet dir may not exist */ }

  // Federation fallback: check peers
  try {
    const config = loadConfig();
    const peers = (config as any).peers || [];
    for (const peer of peers) {
      try {
        const res = await curlFetch(`${peer}/api/sessions`, { timeout: 10000 });
        if (!res.ok) continue;
        const sessions = res.data || [];
        const list = Array.isArray(sessions) ? sessions : sessions.sessions || [];
        for (const s of list) {
          const oracleLower = oracle.toLowerCase();
          const sessionMatch = s.name.toLowerCase().includes(oracleLower);
          const found = (s.windows || []).find((w: any) =>
            w.name === `${oracle}-oracle` || w.name === oracle || w.name.toLowerCase().startsWith(oracleLower)
          ) || (sessionMatch ? (s.windows || [])[0] : null);
          if (found) {
            console.log(`\x1b[36m⚡\x1b[0m ${oracle} found on peer ${peer} — waking remotely`);
            await curlFetch(`${peer}/api/send`, { method: "POST", body: JSON.stringify({ target: `${s.name}:${found.index}`, text: "" }) });
            console.log(`\x1b[32m✓\x1b[0m ${oracle} is running on ${peer} (session ${s.name}:${found.name})`);
            process.exit(0);
          }
        }
      } catch { /* peer unreachable */ }
    }
  } catch { /* no peers */ }

  console.error(`oracle repo not found: ${oracle} (tried local repos, fleet configs, and ${((loadConfig() as any).peers || []).length} peers)`);
  process.exit(1);
}

export async function findWorktrees(parentDir: string, repoName: string): Promise<{ path: string; name: string }[]> {
  const lsOut = await hostExec(`ls -d ${parentDir}/${repoName}.wt-* 2>/dev/null || true`);
  return lsOut.split("\n").filter(Boolean).map(p => ({
    path: p, name: p.split("/").pop()!.replace(`${repoName}.wt-`, ""),
  }));
}

export function getSessionMap(): Record<string, string> { return loadConfig().sessions; }

export function resolveFleetSession(oracle: string): string | null {
  try {
    for (const file of readdirSync(FLEET_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".disabled"))) {
      const config = JSON.parse(readFileSync(join(FLEET_DIR, file), "utf-8"));
      if ((config.windows || []).some((w: any) => w.name === `${oracle}-oracle` || w.name === oracle)) return config.name;
    }
  } catch { /* fleet dir may not exist */ }
  return null;
}

export async function detectSession(oracle: string): Promise<string | null> {
  const sessions = await tmux.listSessions();
  const mapped = getSessionMap()[oracle];
  if (mapped && sessions.find(s => s.name === mapped)) return mapped;
  const patternMatch = sessions.find(s => /^\d+-/.test(s.name) && s.name.endsWith(`-${oracle}`))?.name
    || sessions.find(s => s.name === oracle)?.name;
  if (patternMatch) return patternMatch;
  const fleetSession = resolveFleetSession(oracle);
  if (fleetSession && sessions.find(s => s.name === fleetSession)) return fleetSession;
  return null;
}

export async function setSessionEnv(session: string): Promise<void> {
  for (const [key, val] of Object.entries(getEnvVars())) {
    if (val.startsWith("pass:")) {
      await hostExec(`tmux set-environment -t '${session}' ${key} "$(pass show '${val.slice(5)}')"`)
    } else {
      await tmux.setEnvironment(session, key, val);
    }
  }
}

export function sanitizeBranchName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._\-]/g, "")
    .replace(/\.{2,}/g, ".").replace(/^[-.]|[-.]$/g, "").slice(0, 50);
}
