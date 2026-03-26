import { Hono } from "hono";
import { tmux } from "../tmux";

export const talkApi = new Hono();

// POST /api/talk — send message to oracle via maw hey pattern
talkApi.post("/talk", async (c) => {
  try {
    const { oracle, message } = await c.req.json();
    if (!message) return c.json({ error: "no message" }, 400);

    const oracleName = oracle || "neo";
    const target = `${oracleName}-oracle`;

    // Send to oracle's tmux window (same as maw hey)
    const sessions = await tmux.listAll();
    let windowTarget: string | null = null;

    for (const s of sessions) {
      for (const w of s.windows) {
        if (w.name === target) {
          windowTarget = `${s.name}:${w.index}`;
          break;
        }
      }
      if (windowTarget) break;
    }

    if (!windowTarget) {
      return c.json({ ok: false, error: `${target} not found` }, 404);
    }

    // Send text to the oracle (like maw hey)
    await tmux.sendText(windowTarget, message);

    return c.json({ ok: true, target: windowTarget });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});
