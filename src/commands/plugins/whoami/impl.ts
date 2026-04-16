import { hostExec } from "../../../sdk";

/**
 * maw whoami — print the current tmux session name on stdout.
 * Replaces scattered raw `tmux display-message -p '#S'` calls with one
 * canonical, testable command.
 */
export async function cmdWhoami() {
  if (!process.env.TMUX) {
    throw new Error("maw whoami requires an active tmux session");
  }
  const raw = await hostExec(`tmux display-message -p '#S'`);
  console.log(raw.trim());
}
