import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../src/plugin/types";

const root = join(import.meta.dir, "../src");

mock.module(join(root, "commands/plugins/capture/impl"), () => ({
  cmdCapture: async (target: string, opts: { pane?: number; lines?: number; full?: boolean } = {}) => {
    if (target === "nope-xyz") {
      console.error("✗ session 'nope-xyz' not found");
      throw new Error("exit 1");
    }
    const scope = opts.full ? "full" : `lines=${opts.lines ?? 50}`;
    const paneSuffix = opts.pane !== undefined ? `.${opts.pane}` : "";
    console.log(`captured ${target}${paneSuffix} ${scope}`);
  },
}));

const { default: handler } = await import("../src/commands/plugins/capture/index");

// Helper — CLI tests inject a writer so output is captured even when plugins
// route CLI output through ctx.writer (alpha.47 writer injection pattern).
function cliCtx(args: string[]): { ctx: InvokeContext; out: () => string } {
  const captured: string[] = [];
  return {
    ctx: {
      source: "cli",
      args,
      writer: (...a: unknown[]) => captured.push(a.map(String).join(" ")),
    },
    out: () => captured.join("\n"),
  };
}

describe("capture plugin", () => {
  it("CLI — missing target returns usage", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("CLI — default captures 50 lines", async () => {
    const { ctx, out } = cliCtx(["mawjs-view"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("lines=50");
  });

  it("CLI — --lines overrides default", async () => {
    const { ctx, out } = cliCtx(["mawjs-view", "--lines", "200"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("lines=200");
  });

  it("CLI — --full mode", async () => {
    const { ctx, out } = cliCtx(["mawjs-view", "--full"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("full");
  });

  it("CLI — --pane N included in output", async () => {
    const { ctx, out } = cliCtx(["mawjs-view", "--pane", "2"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("mawjs-view.2");
  });

  it("CLI — not found errors", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["nope-xyz"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("API — target missing errors", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("target is required");
  });

  it("API — target + opts ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { target: "mawjs-view", lines: 30 } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("lines=30");
  });
});
