import { Elysia, t } from "elysia";

/**
 * POST /api/dispatch — dashboard ChatView's send box (2026-07-03, Boss-hit gap).
 *
 * The dashboard has shipped a ChatView that POSTs {from, to, msg} here since day
 * one, but the route never existed server-side — every send died as NOT_FOUND.
 *
 * Implementation deliberately spawns the `maw hey` CLI instead of importing
 * cmdSend in-process: cmdSend calls process.exit() on several failure paths,
 * which would take down this whole server. A child process gives us the full
 * proven delivery pipeline (pane resolution, identity envelope, receiver-inbox
 * write, feed event, verify-submit retry) with process isolation for free.
 */

// Absolute path — pm2's env PATH is not guaranteed to include the CLI.
const MAW_BIN = "/usr/bin/maw";
const TIMEOUT_MS = 20_000; // maw hey's verify-submit probe adds ~800ms; be generous.

export const dispatchApi = new Elysia().post(
  "/dispatch",
  async ({ body, set }) => {
    const { from, to, msg } = body;

    // "labubu-oracle" (UI naming) → "labubu" (maw window naming); allow-list chars.
    const oracle = to.replace(/-oracle$/, "").replace(/[^a-zA-Z0-9_-]/g, "");
    const sender = `white:${(from || "boss").replace(/[^a-zA-Z0-9_-]/g, "") || "boss"}`;
    const text = msg.trim();
    if (!oracle || !text) {
      set.status = 400;
      return { status: "bad-request", dispatched: false, error: "empty target or message" };
    }
    if (text.length > 4000) {
      set.status = 413;
      return { status: "too-long", dispatched: false, error: "message exceeds 4000 chars" };
    }

    // argv array → no shell involved → message content cannot inject commands.
    const proc = Bun.spawn([MAW_BIN, "hey", oracle, text, "--from", sender], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: process.env.HOME || "/root" },
    });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const exited = await proc.exited;
    clearTimeout(timer);
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();

    if (exited === 0) {
      return { status: "delivered", dispatched: true, detail: out.trim().split("\n")[0] ?? "" };
    }
    // Fail-closed: report the real failure, never a fake success.
    set.status = 502;
    return {
      status: "failed",
      dispatched: false,
      error: (err || out || `maw hey exited ${exited}`).trim().slice(0, 300),
    };
  },
  {
    body: t.Object({
      from: t.String(),
      to: t.String(),
      msg: t.String(),
    }),
  },
);
