import { readdirSync } from "fs";
import { hostExec } from "../ssh";
import { tmux } from "../tmux";
import { loadConfig, buildCommandInDir, getEnvVars } from "../config";
import { FLEET_DIR } from "../paths";
import { saveTabOrder, restoreTabOrder } from "../tab-order";
import { loadFleet, type FleetSession } from "./fleet-load";
import { ensureSessionRunning } from "./wake";

// Re-export all fleet subcommands for cli.ts
export { cmdFleetLs, cmdFleetRenumber, cmdFleetValidate, cmdFleetSync, cmdFleetSyncConfigs } from "./fleet-manage";

export async function cmdSleep() {
  const sessions = loadFleet();
  let killed = 0;
  for (const sess of sessions) {
    await saveTabOrder(sess.name);
    try {
      await tmux.killSession(sess.name);
      console.log(`  \x1b[90m●\x1b[0m ${sess.name} — sleep`);
      killed++;
    } catch { /* session didn't exist */ }
  }
  console.log(`\n  ${killed} sessions put to sleep.\n`);
}

async function resumeActiveItems() {
  const repo = "laris-co/pulse-oracle";
  try {
    const issuesJson = await hostExec(
      `gh issue list --repo ${repo} --state open --json number,title,labels --limit 50`
    );
    const issues: { number: number; title: string; labels: { name: string }[] }[] = JSON.parse(issuesJson || "[]");
    const oracleItems = issues
      .filter(i => !i.labels.some(l => l.name === "daily-thread"))
      .map(i => ({ ...i, oracle: i.labels.find(l => l.name.startsWith("oracle:"))?.name.replace("oracle:", "") }))
      .filter(i => i.oracle);

    if (!oracleItems.length) { console.log("  \x1b[90mNo active board items to resume.\x1b[0m"); return; }

    const byOracle = new Map<string, typeof oracleItems>();
    for (const item of oracleItems) {
      const list = byOracle.get(item.oracle!) || [];
      list.push(item);
      byOracle.set(item.oracle!, list);
    }

    for (const [oracle, items] of byOracle) {
      const windowName = `${oracle}-oracle`;
      const sessions = await tmux.listSessions();
      for (const sess of sessions) {
        try {
          const windows = await tmux.listWindows(sess.name);
          const win = windows.find(w => w.name.toLowerCase() === windowName.toLowerCase());
          if (win) {
            const titles = items.map(i => `#${i.number}`).join(", ");
            await new Promise(r => setTimeout(r, 2000));
            await tmux.sendText(`${sess.name}:${win.name}`, `/recap --deep — Resume after reboot. Active items: ${titles}`);
            console.log(`  \x1b[32m↻\x1b[0m ${oracle}: /recap sent (${titles})`);
            break;
          }
        } catch { /* window not found */ }
      }
    }
  } catch (e) { console.log(`  \x1b[33mresume skipped:\x1b[0m ${e}`); }
}

async function respawnMissingWorktrees(sessions: FleetSession[]): Promise<number> {
  const ghqRoot = loadConfig().ghqRoot;
  let spawned = 0;

  for (const sess of sessions) {
    if (sess.skip_command) continue;
    const mainWindows = sess.windows.filter(w => w.name.endsWith("-oracle"));
    const registeredNames = new Set(sess.windows.map(w => w.name));

    for (const main of mainWindows) {
      const oracleName = main.name.replace(/-oracle$/, "");
      const repoPath = `${ghqRoot}/${main.repo}`;
      const repoName = main.repo.split("/").pop()!;
      const parentDir = repoPath.replace(/\/[^/]+$/, "");

      let wtPaths: string[] = [];
      try {
        const raw = await hostExec(`ls -d ${parentDir}/${repoName}.wt-* 2>/dev/null || true`);
        wtPaths = raw.split("\n").filter(Boolean);
      } catch { continue; }

      let runningWindows: string[] = [];
      try { runningWindows = (await tmux.listWindows(sess.name)).map(w => w.name); } catch { continue; }

      const usedNames = new Set([...registeredNames, ...runningWindows]);
      for (const wtPath of wtPaths) {
        const suffix = wtPath.split("/").pop()!.replace(`${repoName}.wt-`, "");
        const taskPart = suffix.replace(/^\d+-/, "");
        let windowName = `${oracleName}-${taskPart}`;
        if (usedNames.has(windowName)) {
          if (registeredNames.has(windowName) || runningWindows.includes(windowName)) continue;
          windowName = `${oracleName}-${suffix}`;
        }
        const altName = `${oracleName}-${suffix}`;
        if (registeredNames.has(windowName) || registeredNames.has(altName)) continue;
        if (runningWindows.includes(windowName) || runningWindows.includes(altName)) continue;

        usedNames.add(windowName);
        try {
          await tmux.newWindow(sess.name, windowName, { cwd: wtPath });
          await new Promise(r => setTimeout(r, 300));
          await tmux.sendText(`${sess.name}:${windowName}`, buildCommandInDir(windowName, wtPath));
          console.log(`  \x1b[32m↻\x1b[0m ${windowName} (discovered on disk)`);
          spawned++;
        } catch { /* window creation failed */ }
      }
    }
  }
  return spawned;
}

export async function cmdWakeAll(opts: { kill?: boolean; all?: boolean; resume?: boolean } = {}) {
  const allSessions = loadFleet();
  const sessions = opts.all ? allSessions : allSessions.filter(s => {
    const num = parseInt(s.name.split("-")[0], 10);
    return isNaN(num) || num < 20 || num >= 99;
  });
  const skipped = allSessions.length - sessions.length;

  if (opts.kill) { console.log(`\n  \x1b[33mKilling existing sessions...\x1b[0m\n`); await cmdSleep(); }

  const disabled = readdirSync(FLEET_DIR).filter(f => f.endsWith(".disabled")).length;
  const skipMsg = skipped > 0 ? `, ${skipped} dormant skipped` : "";
  console.log(`\n  \x1b[36mWaking fleet...\x1b[0m  (${sessions.length} sessions${disabled ? `, ${disabled} disabled` : ""}${skipMsg})\n`);

  let sessCount = 0, winCount = 0;

  for (const sess of sessions) {
    if (await tmux.hasSession(sess.name)) { console.log(`  \x1b[33m●\x1b[0m ${sess.name} — already awake`); continue; }

    const first = sess.windows[0];
    const firstPath = `${loadConfig().ghqRoot}/${first.repo}`;
    await tmux.newSession(sess.name, { window: first.name, cwd: firstPath });
    for (const [key, val] of Object.entries(getEnvVars())) await tmux.setEnvironment(sess.name, key, val);

    if (!sess.skip_command) {
      await new Promise(r => setTimeout(r, 300));
      try { await tmux.sendText(`${sess.name}:${first.name}`, buildCommandInDir(first.name, firstPath)); } catch { /* ok */ }
    }
    winCount++;

    for (let i = 1; i < sess.windows.length; i++) {
      const win = sess.windows[i];
      const winPath = `${loadConfig().ghqRoot}/${win.repo}`;
      try {
        await tmux.newWindow(sess.name, win.name, { cwd: winPath });
        if (!sess.skip_command) { await new Promise(r => setTimeout(r, 300)); await tmux.sendText(`${sess.name}:${win.name}`, buildCommandInDir(win.name, winPath)); }
        winCount++;
      } catch { /* dup name or bad path */ }
    }

    await tmux.selectWindow(`${sess.name}:1`);
    sessCount++;
    console.log(`  \x1b[32m●\x1b[0m ${sess.name} — ${sess.windows.length} windows`);
  }

  winCount += await respawnMissingWorktrees(sessions);

  if (sessCount > 0) {
    console.log("  \x1b[36mVerifying sessions...\x1b[0m");
    await new Promise(r => setTimeout(r, 3000));
    let totalRetried = 0;
    const ghqRoot = loadConfig().ghqRoot;
    for (const sess of sessions) {
      if (sess.skip_command) continue;
      const cwdMap: Record<string, string> = {};
      for (const w of sess.windows) cwdMap[w.name] = `${ghqRoot}/${w.repo}`;
      totalRetried += await ensureSessionRunning(sess.name, undefined, cwdMap);
    }
    console.log(totalRetried > 0 ? `  \x1b[33m${totalRetried} window(s) retried.\x1b[0m` : "  \x1b[32m✓ All windows running.\x1b[0m");
  }

  let totalReordered = 0;
  for (const sess of sessions) totalReordered += await restoreTabOrder(sess.name);
  if (totalReordered > 0) console.log(`  \x1b[36m↻ ${totalReordered} window(s) reordered to saved positions.\x1b[0m`);

  console.log(`\n  \x1b[32m${sessCount} sessions, ${winCount} windows woke up.\x1b[0m\n`);
  if (opts.resume) { console.log("  \x1b[36mResuming active board items...\x1b[0m\n"); await resumeActiveItems(); }
}
