import { Elysia, t } from "elysia";
import { readFileSync, existsSync } from "fs";
import { listSessions, getPaneCommand, isAgentCommand } from "../core/transport/ssh";
import { checkPaneIdle } from "../commands/shared/comm-send";
import { mawMessageLogPath } from "../core/xdg";

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

/** "labubu-oracle" / "labubu" → live tmux target like "01-labubu:0", or null. */
async function resolveOracleTarget(nameRaw: string): Promise<string | null> {
  const oracle = nameRaw.replace(/-oracle$/, "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!oracle) return null;
  const sessions = await listSessions();
  const hit = sessions.find(
    (s: any) =>
      new RegExp(`^\\d+-${oracle}$`).test(s.name) ||
      s.windows?.some((w: any) => w.name === `${oracle}-oracle`),
  );
  return hit ? `${hit.name}:0` : null;
}

export const dispatchApi = new Elysia()
  // GET /api/dispatch/status/:oracle — ChatView's recipient status dot.
  // busy = agent pane has un-submitted input / activity; ready = agent at
  // prompt; offline = no session or no agent process. Fail-closed: any
  // resolution failure reports offline, never a fake ready.
  .get("/dispatch/status/:oracle", async ({ params }) => {
    try {
      const target = await resolveOracleTarget(params.oracle);
      if (!target) return { oracle: params.oracle, status: "offline" };
      const cmd = await getPaneCommand(target);
      if (!isAgentCommand(cmd)) return { oracle: params.oracle, status: "offline", running: cmd };
      const { idle } = await checkPaneIdle(target);
      return { oracle: params.oracle, status: idle ? "ready" : "busy", target };
    } catch {
      return { oracle: params.oracle, status: "offline" };
    }
  })
  // GET /api/chats?limit=N — ChatView's message log, read from the same
  // JSONL every `maw hey`/`maw send` delivery appends to (mawMessageLogPath).
  .get(
    "/chats",
    ({ query }) => {
      const limit = Math.min(Math.max(Number(query.limit) || 500, 1), 2000);
      const logFile = mawMessageLogPath();
      if (!existsSync(logFile)) return { entries: [], total: 0 };
      const lines = readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
      const entries = lines
        .slice(-limit)
        .map((l) => {
          try {
            const e = JSON.parse(l);
            return {
              ts: e.ts,
              from: e.from,
              to: e.to,
              // Delivered text carries the identity envelope ("[white:nat] hi");
              // from/to render separately in the UI, so strip the duplicate.
              msg: String(e.msg || "").replace(/^\[[^\]]+\]\s*/, ""),
              threadId: e.route,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return { entries, total: lines.length };
    },
  )
  .post(
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
