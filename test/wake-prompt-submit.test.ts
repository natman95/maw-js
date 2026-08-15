/**
 * wake-prompt-submit.test.ts — regression for the blind-Enter wake prompt.
 *
 * 🔴 Field failure 2026-08-11 (volt box): a cron one-shot `maw wake -p '<job>'`
 * reported `✅ woke` and the pane showed the whole job text sitting in the
 * input box at 0k/1000k tokens. The job never ran.
 *
 * Cause: sendPromptViaTmux checked for `tmux.run` and, finding it (it lives on
 * Tmux.prototype, so the check is always true), fired ONE blind
 * `send-keys -t <target> <prompt> Enter` — no settle, no confirmation, no
 * warning. That is the pre-fix shape of finding #6, which tmux-class.ts:11-17
 * already documents as "the command sat in the input box unexecuted".
 * sendText() carries the fix; the prompt path bypassed it.
 *
 * Reproduced in the field before writing this test, same command + same prompt
 * + same minute, only the submit method differing:
 *   blind   → prompt still in the input box, 0k tokens  (never submitted)
 *   sendText→ input box empty, 53k tokens               (submitted, working)
 *
 * Strategy: swap the tmux singleton's own methods (they are prototype methods,
 * so an own-property assignment shadows them) and assert which path is taken.
 * No tmux process is started.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { tmux } from "../src/sdk";
import { sendPromptViaTmux, sendWakeCommandAndPrompt } from "../src/commands/shared/wake-cmd";

type Call = string;

/** Shadow the singleton's methods; returns a restore fn and the call log. */
function spyOnTmux() {
  const calls: Call[] = [];
  const t = tmux as unknown as Record<string, unknown>;
  const had = {
    sendText: Object.prototype.hasOwnProperty.call(t, "sendText"),
    run: Object.prototype.hasOwnProperty.call(t, "run"),
  };
  t.sendText = async (target: string, text: string) => {
    calls.push(`sendText:${target}:${text}`);
  };
  t.run = async (subcommand: string, ...args: Array<string | number>) => {
    calls.push(`run:${subcommand}:${args.join(",")}`);
    return "";
  };
  const restore = () => {
    if (!had.sendText) delete t.sendText;
    if (!had.run) delete t.run;
  };
  return { calls, restore };
}

let active: { calls: Call[]; restore: () => void } | null = null;
afterEach(() => {
  active?.restore();
  active = null;
});

describe("wake prompt submission", () => {
  test("prompt goes through sendText (settle + confirm), never a raw send-keys Enter", async () => {
    active = spyOnTmux();
    await sendPromptViaTmux("sess:win", "ล้างข้อมูลประชุมตามที่ Boss สั่ง");

    expect(active.calls).toEqual(["sendText:sess:win:ล้างข้อมูลประชุมตามที่ Boss สั่ง"]);
    // The exact shape that failed in the field — one blind Enter, no confirmation.
    expect(active.calls.some(c => c.startsWith("run:send-keys"))).toBe(false);
    expect(active.calls.some(c => c.includes("Enter"))).toBe(false);
  });

  test("the always-true `tmux.run` branch is gone — run exists yet is never used", async () => {
    // Guards the specific reason the bug survived: `run` is a prototype method,
    // so `typeof tmux.run === "function"` was true on every single call and the
    // sendText fallback was dead code that no test ever reached.
    expect(typeof (tmux as unknown as { run?: unknown }).run).toBe("function");

    active = spyOnTmux();
    await sendPromptViaTmux("sess:win", "any prompt");
    expect(active.calls.every(c => c.startsWith("sendText:"))).toBe(true);
  });

  test("wake sends the launch command first, then the prompt — both confirmed", async () => {
    active = spyOnTmux();
    await sendWakeCommandAndPrompt("sess:win", "do the thing", "claude --continue");

    expect(active.calls).toEqual([
      "sendText:sess:win:claude --continue",
      "sendText:sess:win:do the thing",
    ]);
  });

  test("no prompt = launch command only", async () => {
    active = spyOnTmux();
    await sendWakeCommandAndPrompt("sess:win", undefined, "claude --continue");

    expect(active.calls).toEqual(["sendText:sess:win:claude --continue"]);
  });
});
