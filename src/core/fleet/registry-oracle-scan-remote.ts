/**
 * registry-oracle-scan-remote — GitHub API oracle discovery.
 *
 * Uses the gh CLI (for auth + pagination) to list repos in target orgs,
 * filters to -oracle suffix, then spot-checks each for a ψ/ directory.
 */

import { execSync } from "child_process";
import { loadConfig } from "../../config";
import type { OracleEntry } from "./registry-oracle-types";
import { deriveName } from "./registry-oracle-scan-local";

export async function scanRemote(orgs?: string[], verbose = false): Promise<OracleEntry[]> {
  const config = loadConfig();
  const defaultOrgs = config.githubOrgs || ["Soul-Brews-Studio", "laris-co"];
  const targetOrgs = orgs || defaultOrgs;
  const now = new Date().toISOString();
  const entries: OracleEntry[] = [];
  const seen = new Set<string>();

  for (const org of targetOrgs) {
    const orgStart = Date.now();
    try {
      // Per-org progress — always shown so the user sees something during the
      // multi-second gh API call. Was behind `if (verbose)` until 2026-04-16
      // (silent dead air for 10-30s confused users — see gist 773655c4).
      process.stdout.write(`  \x1b[90m⏳ scanning ${org}...\x1b[0m`);

      // Use gh CLI for auth-handled pagination
      const out = execSync(
        `gh api "/orgs/${org}/repos?per_page=100&type=all" --paginate --jq '.[] | .full_name + " " + .name'`,
        { encoding: "utf-8", timeout: 30000 },
      );

      const repos = out.trim().split("\n").filter(Boolean);
      const oracleRepos = repos.filter(l => l.split(" ")[1]?.endsWith("-oracle"));
      const orgElapsed = ((Date.now() - orgStart) / 1000).toFixed(1);
      console.log(` \x1b[32m✓\x1b[0m ${repos.length} repos, ${oracleRepos.length} oracles (${orgElapsed}s)`);

      for (const line of oracleRepos) {
        const [fullName, repoName] = line.split(" ");
        if (!repoName) continue;

        const key = fullName;
        if (seen.has(key)) continue;
        seen.add(key);

        // Per-repo progress — always visible. Without this, ψ/ detection on
        // a large org (e.g. laris-co with 34 oracles × ~1.5s each gh api
        // call) looks frozen for ~50s (user report 2026-04-16, alpha.72).
        // --verbose is no longer needed for per-repo visibility.
        process.stdout.write(`  \x1b[90m  checking ${repoName}...\x1b[0m`);

        // Check for ψ/ directory via API (light — just HEAD check)
        let hasPsi = false;
        try {
          execSync(`gh api "/repos/${fullName}/contents/ψ" --silent 2>/dev/null`, { timeout: 5000 });
          hasPsi = true;
        } catch { /* no ψ/ */ }

        console.log(hasPsi ? " \x1b[32mψ/\x1b[0m" : " \x1b[90m—\x1b[0m");

        entries.push({
          org,
          repo: repoName,
          name: deriveName(repoName),
          local_path: "",
          has_psi: hasPsi,
          has_fleet_config: false,
          budded_from: null,
          budded_at: null,
          federation_node: null,
          detected_at: now,
        });
      }
    } catch (err) {
      // Newline first so error doesn't concatenate with the "scanning..." line above
      console.log();
      console.warn(`  \x1b[33m⚠\x1b[0m [oracle-registry] ${org} failed: ${(err as Error).message?.slice(0, 80)}`);
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
