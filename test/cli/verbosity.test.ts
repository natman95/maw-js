/**
 * Tests for src/cli/verbosity.ts — #343 part A (task #2).
 *
 * verbosity.ts holds module-level state, so beforeEach resets both the stored
 * flags and the env vars to guarantee test isolation.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  isQuiet,
  isSilent,
  setVerbosityFlags,
  verbose,
  warn,
  info,
  error,
} from "../../src/cli/verbosity";

describe("verbosity", () => {
  beforeEach(() => {
    setVerbosityFlags({});
    delete process.env.MAW_QUIET;
    delete process.env.MAW_SILENT;
  });

  test("default: no flag, no env → neither quiet nor silent", () => {
    expect(isQuiet()).toBe(false);
    expect(isSilent()).toBe(false);
  });

  test("--quiet flag: quiet true, silent false", () => {
    setVerbosityFlags({ quiet: true });
    expect(isQuiet()).toBe(true);
    expect(isSilent()).toBe(false);
  });

  test("--silent flag: silent true AND implies quiet", () => {
    setVerbosityFlags({ silent: true });
    expect(isSilent()).toBe(true);
    expect(isQuiet()).toBe(true);
  });

  test("env-only MAW_QUIET=1 → quiet true without any flag", () => {
    process.env.MAW_QUIET = "1";
    expect(isQuiet()).toBe(true);
    expect(isSilent()).toBe(false);
  });

  test("flag overrides env: explicit quiet:false beats MAW_QUIET=1", () => {
    process.env.MAW_QUIET = "1";
    setVerbosityFlags({ quiet: false });
    expect(isQuiet()).toBe(false);
  });

  test("silent implies quiet even when quiet flag is explicitly false", () => {
    setVerbosityFlags({ quiet: false, silent: true });
    expect(isSilent()).toBe(true);
    expect(isQuiet()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Surface behavior — verify gating matches the predicates above.
  // ---------------------------------------------------------------------------

  describe("surfaces", () => {
    let stderrChunks: string[] = [];
    let originalWrite: typeof process.stderr.write;

    beforeEach(() => {
      stderrChunks = [];
      originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: any) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as any;
    });

    afterEach(() => {
      process.stderr.write = originalWrite;
    });

    test("verbose() runs fn when not quiet, skips when quiet", () => {
      let hit = 0;
      verbose(() => { hit++; });
      expect(hit).toBe(1);

      setVerbosityFlags({ quiet: true });
      verbose(() => { hit++; });
      expect(hit).toBe(1);
    });

    test("warn/info suppressed when quiet; error always prints", () => {
      setVerbosityFlags({ silent: true });
      warn("w");
      info("i");
      error("e");
      const joined = stderrChunks.join("");
      expect(joined).not.toContain("w");
      expect(joined).not.toContain("i");
      expect(joined).toContain("e");
    });
  });
});
