import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { CONFIG_DIR } from "../paths";
import { listSnapshots, loadSnapshot, latestSnapshot } from "../snapshot";

export const monitoringApi = new Hono();

const AUDIT_FILE = join(CONFIG_DIR, "audit.jsonl");

/** Health overview — aggregated from audit log */
monitoringApi.get("/monitoring/health", (c) => {
  try {
    const entries = readAuditLog(200);

    // Group by oracle
    const oracles = new Map<string, {
      name: string;
      lastSeen: string;
      totalSessions: number;
      crashes: number;
      lastCrash: string | null;
      events: number;
    }>();

    for (const entry of entries) {
      const name = entry.oracle || entry.session || "unknown";
      if (!oracles.has(name)) {
        oracles.set(name, {
          name,
          lastSeen: entry.timestamp || entry.ts || "",
          totalSessions: 0,
          crashes: 0,
          lastCrash: null,
          events: 0,
        });
      }
      const o = oracles.get(name)!;
      o.events++;
      if (entry.timestamp > o.lastSeen) o.lastSeen = entry.timestamp;
      if (entry.event === "SessionStart" || entry.action === "wake") o.totalSessions++;
      if (entry.event === "Error" || entry.action === "crash" || entry.status === "crashed") {
        o.crashes++;
        if (!o.lastCrash || entry.timestamp > o.lastCrash) o.lastCrash = entry.timestamp;
      }
    }

    const latest = latestSnapshot();

    return c.json({
      oracles: Array.from(oracles.values()),
      latestSnapshot: latest ? {
        timestamp: latest.timestamp,
        trigger: latest.trigger,
        sessions: latest.sessions.length,
      } : null,
    });
  } catch (e: any) {
    return c.json({ oracles: [], error: e.message });
  }
});

/** Audit log — paginated with optional oracle filter */
monitoringApi.get("/monitoring/audit", (c) => {
  try {
    const oracle = c.req.query("oracle");
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    let entries = readAuditLog(500);
    if (oracle) {
      entries = entries.filter(e =>
        e.oracle === oracle || e.session === oracle || e.name === oracle
      );
    }

    const total = entries.length;
    const page = entries.slice(offset, offset + limit);

    return c.json({ entries: page, total, limit, offset });
  } catch (e: any) {
    return c.json({ entries: [], total: 0, error: e.message });
  }
});

/** Snapshots list */
monitoringApi.get("/snapshots", (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const snapshots = listSnapshots().slice(0, limit);
    return c.json({ snapshots });
  } catch (e: any) {
    return c.json({ snapshots: [], error: e.message });
  }
});

/** Get specific snapshot */
monitoringApi.get("/snapshots/:id", (c) => {
  try {
    const snapshot = loadSnapshot(c.req.param("id"));
    if (!snapshot) return c.json({ error: "Snapshot not found" }, 404);
    return c.json({ snapshot });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/** Read audit log — returns newest first */
function readAuditLog(maxLines: number): any[] {
  if (!existsSync(AUDIT_FILE)) return [];
  try {
    const content = readFileSync(AUDIT_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines
      .slice(-maxLines)
      .reverse()
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
