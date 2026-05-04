import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";
import { FLEET_DIR } from "../../../core/paths";
import { loadFleetEntries } from "../../shared/fleet-load";

function extractOracleStem(claudeMdPath: string): string | null {
  const line1 = readFileSync(claudeMdPath, "utf8")
    .split("\n")[0]
    .replace(/^#\s*/, "");
  if (!line1 || /project instructions|generic ai|quick reference/i.test(line1)) return null;
  return line1
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s*[Oo]racle\s*$/i, "")
    .replace(/\s*—.*$/, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "") || null;
}

interface Orphan {
  repo: string;
  org: string;
  stem: string;
  path: string;
  identity: string;
}

function scanOrphans(): Orphan[] {
  let ghqRoot: string;
  try {
    ghqRoot = execSync("ghq root", { encoding: "utf8" }).trim();
  } catch { return []; }
  const repos = execSync("ghq list", { encoding: "utf8" }).trim().split("\n");
  const entries = loadFleetEntries();
  const registered = new Set(
    entries.flatMap(e => e.session.windows?.map(w => w.repo) ?? []),
  );

  const orphans: Orphan[] = [];
  for (const rel of repos) {
    if (rel.includes(".wt-")) continue;
    const full = join(ghqRoot, rel);
    const claudeMd = join(full, "CLAUDE.md");
    const psi = join(full, "ψ");
    if (!existsSync(claudeMd) || (!existsSync(psi) && !existsSync(join(full, "ψ")))) continue;

    const parts = rel.split("/");
    const org = parts[1] || "";
    const repo = parts[2] || basename(full);
    if (registered.has(`${org}/${repo}`)) continue;

    const identity = readFileSync(claudeMd, "utf8").split("\n")[0].replace(/^#\s*/, "");
    const stem = extractOracleStem(claudeMd);
    if (!stem) continue;

    orphans.push({ repo, org, stem, path: full, identity });
  }
  return orphans;
}

export async function cmdFleetAdopt(args: string[]) {
  const isScan = args.includes("--scan");
  const isDryRun = args.includes("--dry-run");
  const asIdx = args.indexOf("--as");
  const nameOverride = asIdx !== -1 ? args[asIdx + 1] : undefined;
  const targets = args.filter(a => !a.startsWith("--") && a !== nameOverride);

  if (isScan) {
    const orphans = scanOrphans();
    if (orphans.length === 0) {
      console.log("  \x1b[32m✓\x1b[0m No orphan oracles — fleet is complete.");
      return;
    }
    console.log(`  Orphan oracles (\x1b[33m${orphans.length}\x1b[0m not in fleet):\n`);
    for (let i = 0; i < orphans.length; i++) {
      const o = orphans[i];
      console.log(`  ${String(i + 1).padStart(3)}  ${o.repo.padEnd(35)} → ${o.identity.substring(0, 30).padEnd(30)} (${o.org})`);
    }
    console.log(`\n  Adopt: \x1b[36mmaw fleet adopt <repo-name>\x1b[0m`);
    return;
  }

  if (targets.length === 0) {
    console.log("  usage: maw fleet adopt <repo-name> [--as <stem>] [--dry-run]");
    console.log("         maw fleet adopt --scan");
    return;
  }

  const orphans = scanOrphans();
  const entries = loadFleetEntries();
  let maxNum = entries.reduce((max, e) => Math.max(max, e.num), 0);

  for (const target of targets) {
    const match = orphans.find(o => o.repo === target || o.stem === target || o.repo.includes(target));
    if (!match) {
      console.log(`  \x1b[31m✗\x1b[0m '${target}' not found or already in fleet`);
      continue;
    }

    const stem = nameOverride || match.stem;
    const existingStem = entries.find(e => e.groupName === stem);
    if (existingStem) {
      console.log(`  \x1b[31m✗\x1b[0m '${stem}' already exists in fleet — use --as <other-name>`);
      continue;
    }

    maxNum++;
    const fileName = `${String(maxNum).padStart(2, "0")}-${stem}.json`;
    const config = {
      name: `${String(maxNum).padStart(2, "0")}-${stem}`,
      windows: [{ name: `${stem}-oracle`, repo: `${match.org}/${match.repo}` }],
      adopted_at: new Date().toISOString(),
      adopted_from: `ghq:${match.org}/${match.repo}`,
    };

    if (isDryRun) {
      console.log(`  \x1b[90m[dry-run]\x1b[0m would create: ${fileName}`);
      console.log(JSON.stringify(config, null, 2));
      continue;
    }

    writeFileSync(join(FLEET_DIR, fileName), JSON.stringify(config, null, 2) + "\n");
    console.log(`  \x1b[32m✅\x1b[0m adopted: ${match.repo} → ${stem} (${fileName})`);
    console.log(`     repo: ${match.org}/${match.repo}`);
    console.log(`     fleet: ~/.config/maw/fleet/${fileName}`);
    console.log(`     next: \x1b[36mmaw wake ${stem}\x1b[0m`);
  }
}
