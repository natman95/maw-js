/**
 * `maw init` — plugins.lock bootstrap (#680 ask #4).
 *
 * Isolated (per-file subprocess) so we can set MAW_PLUGINS_LOCK before the
 * first import chain pulls in lock.ts / init impl.ts.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = mkdtempSync(join(tmpdir(), "maw-init-bootstrap-680-"));
const LOCK_PATH = join(TEST_DIR, "plugins.lock");
process.env.MAW_PLUGINS_LOCK = LOCK_PATH;

let bootstrapPluginsLock: typeof import("../../src/commands/plugins/init/bootstrap-plugins-lock").bootstrapPluginsLock;
let LOCK_SCHEMA: number;

beforeAll(async () => {
  ({ bootstrapPluginsLock } = await import("../../src/commands/plugins/init/bootstrap-plugins-lock"));
  ({ LOCK_SCHEMA } = await import("../../src/commands/plugins/plugin/lock"));
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  if (existsSync(LOCK_PATH)) rmSync(LOCK_PATH);
});

describe("bootstrapPluginsLock", () => {
  test("creates plugins.lock with empty-but-valid shape when absent", () => {
    expect(existsSync(LOCK_PATH)).toBe(false);

    const result = bootstrapPluginsLock();

    expect(result.created).toBe(true);
    expect(result.path).toBe(LOCK_PATH);
    expect(existsSync(LOCK_PATH)).toBe(true);

    const parsed = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    expect(parsed.schema).toBe(LOCK_SCHEMA);
    expect(parsed.plugins).toEqual({});
    expect(typeof parsed.updated).toBe("string");
    expect(() => new Date(parsed.updated).toISOString()).not.toThrow();
  });

  test("readLock round-trips the bootstrapped file without errors", async () => {
    bootstrapPluginsLock();
    const { readLock } = await import("../../src/commands/plugins/plugin/lock");
    const lock = readLock();
    expect(lock.schema).toBe(LOCK_SCHEMA);
    expect(lock.plugins).toEqual({});
  });

  test("preserves an existing lockfile — no overwrite, no merge", () => {
    const original = {
      schema: LOCK_SCHEMA,
      updated: "2026-01-01T00:00:00.000Z",
      plugins: {
        health: {
          version: "1.0.0",
          sha256: "sha256:" + "a".repeat(64),
          source: "link:/tmp/health",
          added: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    writeFileSync(LOCK_PATH, JSON.stringify(original, null, 2) + "\n", "utf8");
    const before = readFileSync(LOCK_PATH, "utf8");

    const result = bootstrapPluginsLock();

    expect(result.created).toBe(false);
    expect(result.path).toBe(LOCK_PATH);
    expect(readFileSync(LOCK_PATH, "utf8")).toBe(before);
  });
});
