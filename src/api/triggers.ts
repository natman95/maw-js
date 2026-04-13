import { Hono } from "hono";
import { getTriggers, getTriggerHistory, fire, type TriggerContext } from "../triggers";
import type { TriggerEvent } from "../config";
import { validateBody } from "../lib/validate";
import { TriggerFireBody, type TTriggerFireBody } from "../lib/schemas";

export const triggersApi = new Hono();

/** GET /triggers — list configured triggers + last fired */
triggersApi.get("/triggers", (c) => {
  const triggers = getTriggers();
  const history = getTriggerHistory();

  const items = triggers.map((t, i) => {
    const last = history.find(h => h.index === i);
    return {
      index: i,
      on: t.on,
      repo: t.repo || null,
      timeout: t.timeout || null,
      action: t.action,
      name: t.name || null,
      lastFired: last ? {
        ts: last.result.ts,
        ok: last.result.ok,
        action: last.result.action,
        error: last.result.error || null,
      } : null,
    };
  });

  return c.json({ triggers: items, total: items.length });
});

/** POST /triggers/fire — manually fire a trigger event */
triggersApi.post("/triggers/fire", validateBody(TriggerFireBody), async (c) => {
  const body = c.get("body") as TTriggerFireBody;
  const event = body.event as TriggerEvent;
  const ctx: TriggerContext = body.context || {};

  const results = fire(event, ctx);
  return c.json({
    ok: true,
    event,
    fired: results.length,
    results: results.map(r => ({
      action: r.action,
      ok: r.ok,
      output: r.output || null,
      error: r.error || null,
    })),
  });
});
