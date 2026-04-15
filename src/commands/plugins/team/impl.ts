import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { tmux } from "../../../sdk";
import type { TmuxPane } from "../../../sdk";
import { loadFleetEntries } from "../../shared/fleet-load";
import { assertValidOracleName } from "../../../core/fleet/validate";

// Exported for testing — override with setTeamsDir/setTasksDir
let TEAMS_DIR = join(homedir(), ".claude/teams");
let TASKS_DIR = join(homedir(), ".claude/tasks");

/** @internal — for tests only */
export function _setDirs(teams: string, tasks: string) {
  TEAMS_DIR = teams;
  TASKS_DIR = tasks;
}

interface TeamMember {
  name: string;
  agentId?: string;
  agentType?: string;
  tmuxPaneId?: string;
  color?: string;
  model?: string;
  backendType?: string;
}

interface TeamConfig {
  name: string;
  description?: string;
  members: TeamMember[];
  createdAt?: number;
}

export function loadTeam(name: string): TeamConfig | null {
  const configPath = join(TEAMS_DIR, name, "config.json");
  if (!existsSync(configPath)) return null;
  try { return JSON.parse(readFileSync(configPath, "utf-8")); }
  catch { return null; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Write a shutdown_request message to a teammate's inbox file.
 * This is the same protocol Claude Code uses internally via SendMessage.
 */
export function writeShutdownRequest(teamName: string, memberName: string, reason: string): void {
  const inboxPath = join(TEAMS_DIR, teamName, "inboxes", `${memberName}.json`);
  let messages: any[] = [];
  if (existsSync(inboxPath)) {
    try { messages = JSON.parse(readFileSync(inboxPath, "utf-8")); } catch { messages = []; }
  }
  const requestId = `shutdown-${Date.now()}@${memberName}`;
  messages.push({
    from: "maw-team-shutdown",
    text: JSON.stringify({ type: "shutdown_request", reason, request_id: requestId }),
    summary: `Shutdown request: ${reason}`,
    timestamp: new Date().toISOString(),
    read: false,
  });
  writeFileSync(inboxPath, JSON.stringify(messages, null, 2));
}

/** Resolve ψ/ directory from cwd — the oracle vault root. */
function resolvePsi(): string {
  const psi = join(process.cwd(), "ψ");
  if (existsSync(psi)) return psi;
  // fallback: try readlink in case it's a symlink target
  try {
    const real = readFileSync(psi, "utf-8"); // will throw if not exists
    return real;
  } catch {
    return psi; // return default — callers mkdir as needed
  }
}

/**
 * Write a generic message to a teammate's inbox file.
 * Same protocol as writeShutdownRequest but with type: "message".
 */
export function writeMessage(teamName: string, memberName: string, from: string, text: string): void {
  const inboxPath = join(TEAMS_DIR, teamName, "inboxes", `${memberName}.json`);
  let messages: any[] = [];
  if (existsSync(inboxPath)) {
    try { messages = JSON.parse(readFileSync(inboxPath, "utf-8")); } catch { messages = []; }
  }
  messages.push({
    from,
    text: JSON.stringify({ type: "message", content: text }),
    summary: text.slice(0, 80),
    timestamp: new Date().toISOString(),
    read: false,
  });
  const dir = join(TEAMS_DIR, teamName, "inboxes");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(inboxPath, JSON.stringify(messages, null, 2));
}

// ─── A1: maw team shutdown <name> ───

export async function cmdTeamShutdown(name: string, opts: { force?: boolean; merge?: boolean } = {}) {
  const team = loadTeam(name);
  if (!team) {
    console.error(`\x1b[31m✗\x1b[0m team not found: ${name}`);
    console.error(`  check ~/.claude/teams/ for available teams`);
    process.exit(1);
  }

  const teammates = team.members.filter(m => m.agentType !== "team-lead");
  if (!teammates.length) {
    console.log(`\x1b[90mNo teammates to shut down in '${name}'.\x1b[0m`);
    return;
  }

  const panes = await tmux.listPaneIds();
  const alive = teammates.filter(m =>
    m.tmuxPaneId && m.tmuxPaneId !== "in-process" && m.tmuxPaneId !== "" && panes.has(m.tmuxPaneId)
  );

  if (!alive.length) {
    console.log(`\x1b[90mAll teammates in '${name}' already exited. Cleaning up config...\x1b[0m`);
    cleanupTeamDir(name);
    return;
  }

  console.log(`\x1b[36m⏳\x1b[0m shutting down ${alive.length} teammate(s) in '${name}'...`);

  // Step 1: Send shutdown_request via inbox files
  for (const m of alive) {
    try {
      writeShutdownRequest(name, m.name, "team teardown via maw team shutdown");
      console.log(`  \x1b[90m↪ shutdown_request → ${m.name} (${m.tmuxPaneId})\x1b[0m`);
    } catch (e) {
      console.error(`  \x1b[31m✗\x1b[0m failed to send shutdown to ${m.name}: ${e}`);
    }
  }

  // Step 2: Wait for panes to die (up to 30s)
  const deadline = Date.now() + 30_000;
  let remaining = alive.length;
  while (Date.now() < deadline && remaining > 0) {
    await sleep(1000);
    const current = await tmux.listPaneIds();
    remaining = alive.filter(m => current.has(m.tmuxPaneId!)).length;
    if (remaining > 0 && Date.now() + 5000 > deadline) break;
  }

  // Step 3: Force-kill stragglers
  const finalPanes = await tmux.listPaneIds();
  for (const m of alive) {
    if (!finalPanes.has(m.tmuxPaneId!)) {
      console.log(`  \x1b[32m✓\x1b[0m ${m.name} shut down gracefully`);
      continue;
    }
    if (opts.force) {
      await tmux.killPane(m.tmuxPaneId!);
      console.log(`  \x1b[33m⚠\x1b[0m force-killed ${m.name} (${m.tmuxPaneId})`);
    } else {
      console.error(`  \x1b[31m✗\x1b[0m ${m.name} did not respond to shutdown_request (use --force to kill)`);
    }
  }

  // FUSION: merge team knowledge into individual oracle mailboxes
  if (opts.merge) {
    const PSI = resolvePsi();
    const teamInboxDir = join(TEAMS_DIR, name, "inboxes");
    for (const m of teammates) {
      const dest = join(PSI, "memory", "mailbox", m.name);
      mkdirSync(dest, { recursive: true });
      // Copy inbox messages
      const src = join(teamInboxDir, `${m.name}.json`);
      if (existsSync(src)) {
        copyFileSync(src, join(dest, `team-${name}-inbox.json`));
      }
      // Copy any findings from team dir
      const memberDir = join(TEAMS_DIR, name, m.name);
      if (existsSync(memberDir)) {
        try {
          for (const f of readdirSync(memberDir).filter(f => f.endsWith("_findings.md"))) {
            copyFileSync(join(memberDir, f), join(dest, f));
          }
        } catch { /* best effort */ }
      }
      console.log(`  \x1b[36m↪\x1b[0m merged ${m.name} → ψ/memory/mailbox/${m.name}/`);
    }
    // Archive manifest instead of deleting
    const manifestSrc = join(TEAMS_DIR, name, "config.json");
    if (existsSync(manifestSrc)) {
      const archiveDest = join(PSI, "memory", "mailbox", "teams", name);
      mkdirSync(archiveDest, { recursive: true });
      copyFileSync(manifestSrc, join(archiveDest, "manifest.json"));
    }
  }

  cleanupTeamDir(name);
  console.log(`\x1b[32m✓\x1b[0m team '${name}' shut down${opts.merge ? " (knowledge merged)" : ""}`);
}

function cleanupTeamDir(name: string) {
  const teamDir = join(TEAMS_DIR, name);
  const tasksDir = join(TASKS_DIR, name);
  if (existsSync(teamDir)) { try { rmSync(teamDir, { recursive: true }); } catch {} }
  if (existsSync(tasksDir)) { try { rmSync(tasksDir, { recursive: true }); } catch {} }
}

// ─── A2: maw team list ───

export async function cmdTeamList() {
  let teamDirs: string[] = [];
  try {
    teamDirs = readdirSync(TEAMS_DIR).filter(d =>
      existsSync(join(TEAMS_DIR, d, "config.json"))
    );
  } catch { /* expected: teams dir may not exist */ }

  if (!teamDirs.length) {
    console.log("\x1b[90mNo teams found in ~/.claude/teams/\x1b[0m");
    return;
  }

  const panes = await tmux.listPaneIds();

  console.log();
  console.log(`  \x1b[36;1mTEAM${" ".repeat(26)}MEMBERS  STATUS          ZOMBIES\x1b[0m`);

  for (const dir of teamDirs) {
    const team = loadTeam(dir);
    if (!team) continue;

    const teammates = team.members.filter(m => m.agentType !== "team-lead");
    const aliveMembers = team.members.filter(m =>
      m.tmuxPaneId && m.tmuxPaneId !== "in-process" && m.tmuxPaneId !== "" && panes.has(m.tmuxPaneId)
    );
    const deadPanes = teammates.filter(m =>
      m.tmuxPaneId && m.tmuxPaneId !== "in-process" && m.tmuxPaneId !== "" && !panes.has(m.tmuxPaneId)
    );

    const name = dir.padEnd(30);
    const memberCount = String(teammates.length).padEnd(9);
    const idle = aliveMembers.filter(m => m.agentType !== "team-lead").length;
    const status = aliveMembers.length > 0
      ? `\x1b[32m${idle} alive\x1b[0m`.padEnd(26)
      : `\x1b[90mno live panes\x1b[0m`.padEnd(26);

    console.log(`  ${name}${memberCount}${status}${deadPanes.length > 0 ? `\x1b[90m${deadPanes.length} exited\x1b[0m` : "0"}`);
  }

  // Check for orphan zombie panes (panes running claude with no matching team)
  const allPanes = await tmux.listPanes();
  const zombies = findZombiePanes(allPanes);
  if (zombies.length > 0) {
    console.log(`\n  \x1b[33m⚠ ${zombies.length} orphan zombie pane(s) detected\x1b[0m — run \x1b[36mmaw cleanup --zombie-agents\x1b[0m`);
  }

  console.log();
}

// ─── A3: maw cleanup --zombie-agents ───

export async function cmdCleanupZombies(opts: { yes?: boolean } = {}) {
  console.log("\x1b[36mScanning tmux panes...\x1b[0m");

  const allPanes = await tmux.listPanes();
  const zombies = findZombiePanes(allPanes);

  if (!zombies.length) {
    console.log("\x1b[32m✓\x1b[0m No zombie agent panes found.");
    return;
  }

  console.log(`\nFound \x1b[33m${zombies.length}\x1b[0m orphan claude pane(s):\n`);
  for (const z of zombies) {
    console.log(`  \x1b[33m${z.paneId}\x1b[0m  ${z.info}  \x1b[90m(team: ${z.teamName} — DELETED)\x1b[0m`);
  }

  if (!opts.yes) {
    console.log(`\nRun with \x1b[36m--yes\x1b[0m to kill them.`);
    return;
  }

  for (const z of zombies) {
    await tmux.killPane(z.paneId);
    console.log(`\x1b[32m✓\x1b[0m killed ${z.paneId}`);
  }
}

interface ZombiePane {
  paneId: string;
  info: string;
  teamName: string;
}

/**
 * Find zombie panes: tmux panes running `claude` that are NOT part of any
 * live team config AND NOT part of the fleet. Fleet-exclusion is critical
 * — without it, every live fleet oracle would be flagged as a zombie.
 */
function findZombiePanes(allPanes: TmuxPane[]): ZombiePane[] {
  // Get all known team pane IDs from existing team configs
  const knownTeamPaneIds = new Set<string>();
  let teamDirs: string[] = [];
  try {
    teamDirs = readdirSync(TEAMS_DIR).filter(d =>
      existsSync(join(TEAMS_DIR, d, "config.json"))
    );
  } catch { /* no teams dir */ }

  for (const dir of teamDirs) {
    const team = loadTeam(dir);
    if (!team) continue;
    for (const m of team.members) {
      if (m.tmuxPaneId && m.tmuxPaneId !== "in-process" && m.tmuxPaneId !== "") {
        knownTeamPaneIds.add(m.tmuxPaneId);
      }
    }
  }

  // Compute the set of fleet session names (e.g. "01-pulse", "08-mawjs").
  // Any pane whose target starts with "<fleet-session>:" is a live fleet
  // oracle and must NEVER be flagged as a zombie.
  const fleetSessions = new Set<string>();
  try {
    for (const entry of loadFleetEntries()) {
      fleetSessions.add(entry.file.replace(/\.json$/, ""));
    }
  } catch { /* no fleet dir */ }
  // Also allow the meta-view session `maw-view` which mirrors fleet panes.
  fleetSessions.add("maw-view");

  const isFleetPane = (target: string): boolean => {
    const session = target.split(":")[0];
    return fleetSessions.has(session);
  };

  // Find claude panes that are (a) not in any team config AND (b) not in the fleet
  return allPanes
    .filter(p =>
      p.command?.includes("claude") &&
      !knownTeamPaneIds.has(p.id) &&
      !isFleetPane(p.target)
    )
    .map(p => ({
      paneId: p.id,
      info: `${p.target}  "${(p.title || "").slice(0, 50)}"`,
      teamName: "unknown",
    }));
}

// ─── B1: maw team create <name> ───

export function cmdTeamCreate(name: string, opts: { description?: string } = {}) {
  assertValidOracleName(name);

  const PSI = resolvePsi();
  const teamDir = join(PSI, "memory", "mailbox", "teams", name);

  if (existsSync(join(teamDir, "manifest.json"))) {
    console.error(`\x1b[31m✗\x1b[0m team '${name}' already exists at ${teamDir}`);
    process.exit(1);
  }

  mkdirSync(teamDir, { recursive: true });

  const manifest = {
    name,
    createdAt: Date.now(),
    members: [] as string[],
    description: opts.description || "",
  };
  writeFileSync(join(teamDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\x1b[32m✓\x1b[0m team '${name}' created`);
  console.log(`  \x1b[90m${teamDir}/manifest.json\x1b[0m`);
}

// ─── B2: maw team spawn <team> <role> ───

export function cmdTeamSpawn(
  teamName: string,
  role: string,
  opts: { model?: string; prompt?: string } = {},
) {
  const PSI = resolvePsi();
  const teamDir = join(PSI, "memory", "mailbox", "teams", teamName);
  const manifestPath = join(teamDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    console.error(`\x1b[31m✗\x1b[0m team '${teamName}' not found — run: maw team create ${teamName}`);
    process.exit(1);
  }

  // Check for past life
  const agentMailbox = join(PSI, "memory", "mailbox", role);
  let pastLife = false;
  let standingOrders = "";
  let latestFindings = "";

  if (existsSync(agentMailbox)) {
    pastLife = true;
    const soPath = join(agentMailbox, "standing-orders.md");
    if (existsSync(soPath)) {
      standingOrders = readFileSync(soPath, "utf-8");
    }
    // Find latest *_findings.md
    try {
      const findings = readdirSync(agentMailbox)
        .filter(f => f.endsWith("_findings.md"))
        .sort()
        .pop();
      if (findings) {
        const lines = readFileSync(join(agentMailbox, findings), "utf-8").split("\n");
        latestFindings = lines.slice(-30).join("\n");
      }
    } catch { /* no findings */ }
  }

  // Build spawn prompt
  const model = opts.model || "sonnet";
  const parts: string[] = [];
  parts.push(`You are '${role}' on team '${teamName}'.`);
  if (opts.prompt) parts.push(opts.prompt);
  if (standingOrders) parts.push(`## Standing Orders (from past life)\n${standingOrders}`);
  if (latestFindings) parts.push(`## Last Known Findings\n${latestFindings}`);

  const spawnPrompt = parts.join("\n\n");

  // Write prompt file for the user to use
  const promptPath = join(teamDir, `${role}-spawn-prompt.md`);
  writeFileSync(promptPath, spawnPrompt);

  // Update manifest with new member
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  if (!manifest.members.includes(role)) {
    manifest.members.push(role);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  console.log(`\x1b[32m✓\x1b[0m spawn prompt written for '${role}'`);
  console.log(`  \x1b[90mpast life: ${pastLife ? "yes" : "no"}\x1b[0m`);
  console.log(`  \x1b[90mmodel: ${model}\x1b[0m`);
  console.log(`  \x1b[90mprompt: ${promptPath}\x1b[0m`);
  console.log();
  console.log(`  \x1b[36mRun:\x1b[0m claude --model ${model} --prompt-file "${promptPath}"`);
}

// ─── B3: maw team send <team> <agent> <message> ───

export function cmdTeamSend(teamName: string, agent: string, message: string) {
  if (!message) {
    console.error(`\x1b[31m✗\x1b[0m usage: maw team send <team> <agent> <message>`);
    process.exit(1);
  }

  // Try CC team inbox first (live team), fallback to vault mailbox
  const team = loadTeam(teamName);
  if (team) {
    writeMessage(teamName, agent, "maw-team-send", message);
    console.log(`\x1b[32m✓\x1b[0m message sent to ${agent} in live team '${teamName}'`);
    return;
  }

  // Fallback: write to ψ mailbox for async delivery
  const PSI = resolvePsi();
  const mailboxDir = join(PSI, "memory", "mailbox", agent);
  mkdirSync(mailboxDir, { recursive: true });
  const msgFile = join(mailboxDir, `msg-${Date.now()}.json`);
  writeFileSync(msgFile, JSON.stringify({
    from: "maw-team-send",
    team: teamName,
    text: message,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log(`\x1b[32m✓\x1b[0m message written to ψ/memory/mailbox/${agent}/ (team not live)`);
}

// ─── B4: maw team resume <name> ───

export function cmdTeamResume(name: string, opts: { model?: string } = {}) {
  const PSI = resolvePsi();
  const manifestPath = join(PSI, "memory", "mailbox", "teams", name, "manifest.json");

  if (!existsSync(manifestPath)) {
    console.error(`\x1b[31m✗\x1b[0m no archived team '${name}' found`);
    console.error(`  \x1b[90mlooked in: ${manifestPath}\x1b[0m`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const members: string[] = manifest.members || [];

  if (!members.length) {
    console.log(`\x1b[90mTeam '${name}' has no members to resume.\x1b[0m`);
    return;
  }

  console.log(`\x1b[36m⏳\x1b[0m resuming team '${name}' — ${members.length} agent(s)...\n`);

  for (const member of members) {
    cmdTeamSpawn(name, member, { model: opts.model });
    console.log();
  }

  console.log(`\x1b[32m✓\x1b[0m team '${name}' resumed — ${members.length} agent(s) reincarnated`);
}

// ─── B5: maw team lives <agent> ───

export function cmdTeamLives(agent: string) {
  const PSI = resolvePsi();
  const mailboxDir = join(PSI, "memory", "mailbox", agent);

  if (!existsSync(mailboxDir)) {
    console.log(`\x1b[90mNo past lives found for '${agent}'\x1b[0m`);
    console.log(`  \x1b[90mlooked in: ${mailboxDir}\x1b[0m`);
    return;
  }

  const files = readdirSync(mailboxDir).sort();

  console.log(`\n  \x1b[36;1m${agent} — past lives\x1b[0m\n`);

  // Standing orders
  const hasOrders = files.includes("standing-orders.md");
  console.log(`  standing orders: ${hasOrders ? "\x1b[32myes\x1b[0m" : "\x1b[90mno\x1b[0m"}`);

  // Findings
  const findings = files.filter(f => f.endsWith("_findings.md"));
  if (findings.length) {
    console.log(`  findings: \x1b[32m${findings.length}\x1b[0m`);
    for (const f of findings) {
      const lines = readFileSync(join(mailboxDir, f), "utf-8").split("\n").length;
      console.log(`    \x1b[90m${f} (${lines} lines)\x1b[0m`);
    }
  } else {
    console.log(`  findings: \x1b[90mnone\x1b[0m`);
  }

  // Other files (messages, team archives)
  const other = files.filter(f => f !== "standing-orders.md" && !f.endsWith("_findings.md"));
  if (other.length) {
    console.log(`  other: \x1b[90m${other.join(", ")}\x1b[0m`);
  }

  console.log();
}
