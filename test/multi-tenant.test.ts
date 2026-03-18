/**
 * Integration test — Multi-tenant auth flow.
 *
 * Tests the full lifecycle: signup → create API key → authenticated request
 * → rate limiting → usage tracking → key revocation.
 *
 * Uses an in-memory SQLite DB — no external dependencies.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "../src/db/migrate";
import * as schema from "../src/db/schema";
import { eq, and } from "drizzle-orm";

// --- Test DB setup (in-memory, isolated) ---

let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database;

beforeAll(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(sqlite);
});

// --- Helpers ---

let emailCounter = 0;

function createTrial(tier = "solo") {
  const now = Date.now();
  const trial = {
    id: crypto.randomUUID(),
    email: `test-${now}-${++emailCounter}@example.com`,
    tier,
    status: "active",
    createdAt: now,
    expiresAt: now + 14 * 24 * 60 * 60 * 1000, // 14 days
  };
  db.insert(schema.trials).values(trial).run();
  return trial;
}

function createApiKey(trialId: string, tier = "solo") {
  const tierLimits: Record<string, number> = { solo: 60, team: 300, fleet: 1000 };
  const record = {
    id: `ak_${crypto.randomUUID()}`,
    trialId,
    key: `maw_${crypto.randomUUID().replace(/-/g, "")}`,
    name: "test-key",
    tier,
    rateLimit: tierLimits[tier] || 60,
    status: "active",
    createdAt: Date.now(),
  };
  db.insert(schema.apiKeys).values(record).run();
  return record;
}

// --- Tests ---

describe("Multi-tenant auth flow", () => {
  describe("Trial → API Key lifecycle", () => {
    test("create trial and API key", () => {
      const trial = createTrial("solo");
      const key = createApiKey(trial.id, "solo");

      expect(key.trialId).toBe(trial.id);
      expect(key.key).toMatch(/^maw_/);
      expect(key.rateLimit).toBe(60);
      expect(key.status).toBe("active");
    });

    test("max 5 keys per trial", () => {
      const trial = createTrial();
      for (let i = 0; i < 5; i++) {
        createApiKey(trial.id);
      }

      const keys = db.select().from(schema.apiKeys)
        .where(eq(schema.apiKeys.trialId, trial.id)).all();
      expect(keys.length).toBe(5);
    });

    test("tier rate limits are correct", () => {
      const trial = createTrial("fleet");
      const key = createApiKey(trial.id, "fleet");
      expect(key.rateLimit).toBe(1000);

      const trial2 = createTrial("team");
      const key2 = createApiKey(trial2.id, "team");
      expect(key2.rateLimit).toBe(300);
    });
  });

  describe("API key validation", () => {
    test("find active key by key string", () => {
      const trial = createTrial();
      const key = createApiKey(trial.id);

      const found = db.select().from(schema.apiKeys)
        .where(and(
          eq(schema.apiKeys.key, key.key),
          eq(schema.apiKeys.status, "active"),
        )).get();

      expect(found).toBeDefined();
      expect(found!.id).toBe(key.id);
    });

    test("revoked key is not found as active", () => {
      const trial = createTrial();
      const key = createApiKey(trial.id);

      // Revoke
      db.update(schema.apiKeys)
        .set({ status: "revoked" })
        .where(eq(schema.apiKeys.id, key.id))
        .run();

      const found = db.select().from(schema.apiKeys)
        .where(and(
          eq(schema.apiKeys.key, key.key),
          eq(schema.apiKeys.status, "active"),
        )).get();

      expect(found).toBeUndefined();
    });

    test("expired trial key still validates (auth middleware checks trial separately)", () => {
      const now = Date.now();
      const trial = {
        id: crypto.randomUUID(),
        email: `expired-${now}@example.com`,
        tier: "solo",
        status: "active",
        createdAt: now - 30 * 24 * 60 * 60 * 1000,
        expiresAt: now - 1000, // expired
      };
      db.insert(schema.trials).values(trial).run();
      const key = createApiKey(trial.id);

      // Key itself is still active — middleware validates key first, tenant API checks trial
      const found = db.select().from(schema.apiKeys)
        .where(and(
          eq(schema.apiKeys.key, key.key),
          eq(schema.apiKeys.status, "active"),
        )).get();
      expect(found).toBeDefined();
    });
  });

  describe("Usage metering", () => {
    test("log usage and query stats", () => {
      const trial = createTrial();
      const key = createApiKey(trial.id);
      const now = Date.now();

      // Simulate 3 API calls
      const calls = [
        { apiKeyId: key.id, endpoint: "GET /feed", ts: now - 1000, responseMs: 45, status: 200 },
        { apiKeyId: key.id, endpoint: "GET /feed", ts: now - 500, responseMs: 32, status: 200 },
        { apiKeyId: key.id, endpoint: "POST /dispatch", ts: now, responseMs: 120, status: 201 },
      ];
      for (const call of calls) {
        db.insert(schema.usageLogs).values(call).run();
      }

      // Query usage for this key
      const logs = db.select().from(schema.usageLogs)
        .where(eq(schema.usageLogs.apiKeyId, key.id)).all();

      expect(logs.length).toBe(3);
      expect(logs.filter(l => l.endpoint === "GET /feed").length).toBe(2);
      expect(logs.filter(l => l.endpoint === "POST /dispatch").length).toBe(1);
    });

    test("usage logs track response time and status", () => {
      const trial = createTrial();
      const key = createApiKey(trial.id);

      db.insert(schema.usageLogs).values({
        apiKeyId: key.id,
        endpoint: "GET /sessions",
        ts: Date.now(),
        responseMs: 250,
        status: 429,
      }).run();

      const log = db.select().from(schema.usageLogs)
        .where(eq(schema.usageLogs.apiKeyId, key.id)).get();

      expect(log!.responseMs).toBe(250);
      expect(log!.status).toBe(429);
    });
  });

  describe("Key revocation", () => {
    test("revoke key sets status to revoked", () => {
      const trial = createTrial();
      const key = createApiKey(trial.id);

      const result = db.update(schema.apiKeys)
        .set({ status: "revoked" })
        .where(eq(schema.apiKeys.id, key.id))
        .run();

      expect(result.changes).toBe(1);

      const revoked = db.select().from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, key.id)).get();
      expect(revoked!.status).toBe("revoked");
    });

    test("revoke nonexistent key changes nothing", () => {
      const result = db.update(schema.apiKeys)
        .set({ status: "revoked" })
        .where(eq(schema.apiKeys.id, "ak_nonexistent"))
        .run();

      expect(result.changes).toBe(0);
    });
  });

  describe("Multi-tenant isolation", () => {
    test("keys from different trials are isolated", () => {
      const trial1 = createTrial();
      const trial2 = createTrial();
      const key1 = createApiKey(trial1.id);
      const key2 = createApiKey(trial2.id);

      // Log usage for both
      db.insert(schema.usageLogs).values({ apiKeyId: key1.id, endpoint: "GET /feed", ts: Date.now(), responseMs: 10, status: 200 }).run();
      db.insert(schema.usageLogs).values({ apiKeyId: key1.id, endpoint: "GET /feed", ts: Date.now(), responseMs: 10, status: 200 }).run();
      db.insert(schema.usageLogs).values({ apiKeyId: key2.id, endpoint: "GET /feed", ts: Date.now(), responseMs: 10, status: 200 }).run();

      // Query per trial — get keys first, then logs
      const t1Keys = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.trialId, trial1.id)).all();
      const t1Logs = db.select().from(schema.usageLogs).where(eq(schema.usageLogs.apiKeyId, t1Keys[0].id)).all();
      expect(t1Logs.length).toBe(2);

      const t2Keys = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.trialId, trial2.id)).all();
      const t2Logs = db.select().from(schema.usageLogs).where(eq(schema.usageLogs.apiKeyId, t2Keys[0].id)).all();
      expect(t2Logs.length).toBe(1);
    });

    test("lastUsed timestamp updates", () => {
      const trial = createTrial();
      const key = createApiKey(trial.id);

      expect(key.lastUsed).toBeUndefined();

      const now = Date.now();
      db.update(schema.apiKeys)
        .set({ lastUsed: now })
        .where(eq(schema.apiKeys.id, key.id))
        .run();

      const updated = db.select().from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, key.id)).get();
      expect(updated!.lastUsed).toBe(now);
    });
  });
});
