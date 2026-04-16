import { tmux } from "../../../sdk";

/**
 * maw rename <tab-number-or-name> <new-name>
 * Rename a window in the current tmux session.
 * Auto-prefixes with oracle name (e.g. "6 claude-proxy" → "neo-claude-proxy").
 */
export async function cmdRename(target: string, newName: string) {
  const session = (await tmux.run("display-message", "-p", "#S")).trim();
  const windows = await tmux.listWindows(session);

  // Find by number or name
  const num = parseInt(target);
  const win = !isNaN(num)
    ? windows.find(w => w.index === num)
    : windows.find(w => w.name === target);

  if (!win) {
    console.error(`tabs: ${windows.map(w => `${w.index}:${w.name}`).join(", ")}`);
    throw new Error(`tab ${target} not found in ${session}`);
  }

  // Auto-prefix: extract oracle name from session (e.g. "03-neo" → "neo")
  const oracle = session.replace(/^\d+-/, "");
  const fullName = newName.startsWith(`${oracle}-`) ? newName : `${oracle}-${newName}`;

  await tmux.run("rename-window", "-t", `${session}:${win.index}`, fullName);
  console.log(`\x1b[32m✓\x1b[0m tab ${win.index} \x1b[33m${win.name}\x1b[0m → \x1b[33m${fullName}\x1b[0m`);
}
