import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../src/plugin/types";

const root = join(import.meta.dir, "../src");

mock.module(join(root, "commands/plugins/kill/impl"), () => ({
  cmdKill: async (target: string, opts: { pane?: number } = {}) => {
    if (target === "ambi") {
      console.error("✗ 'ambi' is ambiguous — matches 2 sessions:");
      console.error("    • ambi-one");
      console.error("    • ambi-two");
      throw new Error("exit 1");
    }
    if (target === "nope-xyz") {
      console.error("✗ session 'nope-xyz' not found");
      throw new Error("exit 1");
    }
    if (target.includes(":") && opts.pane === undefined) {
      console.log(`killed window ${target}`);
      return;
    }
    if (opts.pane !== undefined) {
      console.log(`killed pane ${target}:0.${opts.pane}`);
      return;
    }
    console.log(`killed session ${target}`);
  },
}));

const { default: handler } = await import("../src/commands/plugins/kill/index");

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

describe("kill plugin", () => {
  it("CLI — missing target returns usage error", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("CLI — flag-looking target rejected", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--weird"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("looks like a flag");
  });

  it("CLI — bare session kills the session", async () => {
    const { ctx, out } = cliCtx(["mawjs-view"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("killed session mawjs-view");
  });

  it("CLI — session:window kills a window", async () => {
    const { ctx, out } = cliCtx(["mawjs-view:0"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("killed window mawjs-view:0");
  });

  it("CLI — --pane N kills a pane", async () => {
    const { ctx, out } = cliCtx(["mawjs-view", "--pane", "1"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("killed pane mawjs-view:0.1");
  });

  it("CLI — not found errors with hint to retry", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["nope-xyz"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("CLI — ambiguous target lists candidates", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["ambi"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ambiguous");
    expect(result.error).toContain("ambi-one");
    expect(result.error).toContain("ambi-two");
  });

  it("API — missing target errors", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("target is required");
  });

  it("API — target + pane ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { target: "mawjs-view", pane: 1 } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("killed pane mawjs-view:0.1");
  });
});
