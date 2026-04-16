/**
 * maw plugin init + build — Phase A compiler tests.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { cmdPluginInit } from "../src/commands/plugins/plugin/init-impl";
import {
  cmdPluginBuild,
  inferCapabilities,
} from "../src/commands/plugins/plugin/build-impl";

// ─── Temp dir + process.exit helpers ─────────────────────────────────────────

const created: string[] = [];

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "maw-plugin-build-"));
  created.push(d);
  return d;
}

afterEach(() => {
  for (const d of created.splice(0)) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

async function initIn(cwd: string, args: string[]): Promise<void> {
  const orig = process.cwd();
  process.chdir(cwd);
  try {
    await cmdPluginInit(args);
  } finally {
    process.chdir(orig);
  }
}

/**
 * Run fn with process.exit + console.error captured. Returns {exitCode, errors}.
 *
 * After alpha.57 (process.exit silent-fail audit), most plugin handlers throw
 * `new Error()` instead of calling `process.exit(1)`. The handler's try/catch
 * up the call stack converts the throw into an exit. To keep these tests
 * stable across both styles, this helper treats a thrown Error as exitCode=1
 * and captures its message as part of `errors`.
 */
async function captureExit(fn: () => Promise<unknown>): Promise<{ exitCode: number | undefined; errors: string }> {
  const origExit = process.exit;
  const origError = console.error;
  let exitCode: number | undefined;
  const errs: string[] = [];
  console.error = (...a: any[]) => errs.push(a.map(String).join(" "));
  (process as any).exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error("exit:" + exitCode);
  };
  try {
    await fn();
  } catch (e: any) {
    // process.exit fired: exitCode already set (and the Error message starts with "exit:").
    // Real Error thrown by a handler (post-alpha.57 pattern): treat as exit 1
    // and surface the message in `errors` so existing /invalid name/ etc. assertions hold.
    if (exitCode === undefined && e instanceof Error && !e.message.startsWith("exit:")) {
      exitCode = 1;
      errs.push(e.message);
    }
  } finally {
    (process as any).exit = origExit;
    console.error = origError;
  }
  return { exitCode, errors: errs.join("\n") };
}

// ─── init ────────────────────────────────────────────────────────────────────

describe("maw plugin init --ts", () => {
  test("scaffolds 5 files at ./<name>/", async () => {
    const cwd = tmpDir();
    await initIn(cwd, ["hello", "--ts"]);
    const d = join(cwd, "hello");
    expect(existsSync(join(d, "plugin.json"))).toBe(true);
    expect(existsSync(join(d, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(d, "package.json"))).toBe(true);
    expect(existsSync(join(d, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(d, "README.md"))).toBe(true);
  });

  test("plugin.json has v1 manifest shape with placeholders", async () => {
    const cwd = tmpDir();
    await initIn(cwd, ["hello", "--ts"]);
    const m = JSON.parse(readFileSync(join(cwd, "hello", "plugin.json"), "utf8"));
    expect(m.name).toBe("hello");
    expect(m.version).toBe("0.1.0");
    expect(m.sdk).toBe("^1.0.0");
    expect(m.target).toBe("js");
    expect(m.capabilities).toEqual([]);
    expect(m.artifact).toEqual({ path: "dist/index.js", sha256: null });
    expect(m.entry).toBe("./src/index.ts");
  });

  test("src/index.ts uses @maw/sdk imports", async () => {
    const cwd = tmpDir();
    await initIn(cwd, ["hello", "--ts"]);
    const src = readFileSync(join(cwd, "hello", "src", "index.ts"), "utf8");
    expect(src).toContain('from "@maw/sdk"');
    expect(src).toContain('from "@maw/sdk/plugin"');
  });

  test("package.json ships @maw/sdk via file: absolute path", async () => {
    const cwd = tmpDir();
    await initIn(cwd, ["hello", "--ts"]);
    const pkg = JSON.parse(readFileSync(join(cwd, "hello", "package.json"), "utf8"));
    expect(pkg.type).toBe("module");
    expect(pkg.devDependencies["@maw/sdk"]).toMatch(/^file:\/.+packages\/sdk$/);
    expect(pkg.devDependencies.typescript).toBeDefined();
  });

  test("rejects --ts missing", async () => {
    const cwd = tmpDir();
    const { exitCode } = await captureExit(() => initIn(cwd, ["hello"]));
    expect(exitCode).toBe(1);
  });

  test("rejects invalid name", async () => {
    const cwd = tmpDir();
    const { exitCode, errors } = await captureExit(() => initIn(cwd, ["Bad-NAME", "--ts"]));
    expect(exitCode).toBe(1);
    expect(errors).toMatch(/invalid name/);
  });

  test("rejects if destination exists", async () => {
    const cwd = tmpDir();
    mkdirSync(join(cwd, "hello"));
    const { exitCode, errors } = await captureExit(() => initIn(cwd, ["hello", "--ts"]));
    expect(exitCode).toBe(1);
    expect(errors).toMatch(/already exists/);
  });
});

// ─── inferCapabilities (unit) ────────────────────────────────────────────────

describe("inferCapabilities (regex inference)", () => {
  test("maw.identity() → sdk:identity", () => {
    expect(inferCapabilities("const x = maw.identity();")).toContain("sdk:identity");
  });

  test("multiple maw verbs captured", () => {
    const caps = inferCapabilities("maw.identity(); maw.send('a','b');");
    expect(caps).toContain("sdk:identity");
    expect(caps).toContain("sdk:send");
  });

  test('import "node:fs" → fs:read', () => {
    expect(inferCapabilities('import fs from "node:fs";')).toContain("fs:read");
    expect(inferCapabilities('import { readFileSync } from "node:fs";')).toContain("fs:read");
    expect(inferCapabilities('import { promises } from "node:fs/promises";')).toContain("fs:read");
  });

  test('import "node:child_process" → proc:spawn', () => {
    expect(inferCapabilities('import { spawn } from "node:child_process";')).toContain("proc:spawn");
  });

  test('import "bun:ffi" → ffi:any', () => {
    expect(inferCapabilities('import { dlopen } from "bun:ffi";')).toContain("ffi:any");
  });

  test("global fetch() → net:fetch", () => {
    expect(inferCapabilities("const r = await fetch('https://x');")).toContain("net:fetch");
  });

  test("maw.print.ok() does NOT add net:fetch (member access, not global)", () => {
    // maw.fetch would be caught as sdk:fetch — not net:fetch. Here no fetch anywhere.
    expect(inferCapabilities("maw.print.ok('done');")).not.toContain("net:fetch");
  });

  test("dedupes and sorts output", () => {
    const caps = inferCapabilities("maw.identity(); maw.identity(); maw.identity();");
    expect(caps).toEqual(["sdk:identity"]);
  });
});

// ─── build (end-to-end with real bun build + tar) ────────────────────────────

function makeMinimalPlugin(
  dir: string,
  opts: { target?: string; source?: string; declaredCaps?: string[]; name?: string } = {},
): void {
  const srcDir = join(dir, "src");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(srcDir, "index.ts"),
    opts.source ??
      `export default async () => ({ ok: true, output: "hi" });\n`,
  );
  const manifest: Record<string, unknown> = {
    name: opts.name ?? "fixture",
    version: "0.1.0",
    sdk: "^1.0.0",
    target: opts.target ?? "js",
    entry: "./src/index.ts",
    artifact: { path: "dist/index.js", sha256: null },
    capabilities: opts.declaredCaps ?? [],
    cli: { command: opts.name ?? "fixture" },
  };
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
}

describe("maw plugin build", () => {
  test("produces dist/ + .tgz with correct shape", async () => {
    const dir = tmpDir();
    makeMinimalPlugin(dir);
    await cmdPluginBuild([dir]);
    expect(existsSync(join(dir, "dist", "index.js"))).toBe(true);
    expect(existsSync(join(dir, "dist", "plugin.json"))).toBe(true);
    expect(existsSync(join(dir, "fixture-0.1.0.tgz"))).toBe(true);
  });

  test("dist/plugin.json updates artifact with sha256 + rewrites path", async () => {
    const dir = tmpDir();
    makeMinimalPlugin(dir);
    await cmdPluginBuild([dir]);
    const m = JSON.parse(readFileSync(join(dir, "dist", "plugin.json"), "utf8"));
    expect(m.artifact.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(m.artifact.path).toBe("./index.js");
    expect(m.entry).toBeUndefined(); // entry dropped from built manifest
    expect(m.compiledAt).toBeDefined();
  });

  test("capabilities auto-filled from source (sdk verbs detected)", async () => {
    const dir = tmpDir();
    makeMinimalPlugin(dir, {
      source:
        `const maw: any = {};\nmaw.identity(); maw.send('a','b');\n` +
        `export default async () => ({ ok: true });\n`,
    });
    await cmdPluginBuild([dir]);
    const m = JSON.parse(readFileSync(join(dir, "dist", "plugin.json"), "utf8"));
    expect(m.capabilities).toContain("sdk:identity");
    expect(m.capabilities).toContain("sdk:send");
  });

  test("target 'wasm' errors with Phase C message", async () => {
    const dir = tmpDir();
    makeMinimalPlugin(dir, { target: "wasm" });
    const { exitCode, errors } = await captureExit(() => cmdPluginBuild([dir]));
    expect(exitCode).toBe(1);
    expect(errors).toMatch(/Phase C/);
  });

  test("tarball is flat: plugin.json + index.js at root", async () => {
    const dir = tmpDir();
    makeMinimalPlugin(dir);
    await cmdPluginBuild([dir]);
    // Inspect tarball contents using `tar -tzf`
    const { spawnSync } = await import("child_process");
    const list = spawnSync("tar", ["-tzf", join(dir, "fixture-0.1.0.tgz")], { encoding: "utf8" });
    expect(list.status).toBe(0);
    const entries = list.stdout.trim().split("\n").sort();
    expect(entries).toEqual(["index.js", "plugin.json"]);
  });

  test("errors on missing plugin.json", async () => {
    const dir = tmpDir();
    const { exitCode, errors } = await captureExit(() => cmdPluginBuild([dir]));
    expect(exitCode).toBe(1);
    expect(errors).toMatch(/no plugin\.json/);
  });
});
