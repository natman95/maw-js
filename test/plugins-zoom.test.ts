import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../src/plugin/types";

const root = join(import.meta.dir, "../src");

mock.module(join(root, "commands/plugins/zoom/impl"), () => ({
  cmdZoom: async (target: string, opts: { pane?: number } = {}) => {
    if (target === "ambi") {
      console.error("✗ 'ambi' is ambiguous");
      throw new Error("exit 1");
    }
    if (target === "nope-xyz") {
      console.error("✗ session 'nope-xyz' not found");
      throw new Error("exit 1");
    }
    const suffix = opts.pane !== undefined ? `.${opts.pane}` : "";
    console.log(`zoom ${target}${suffix}`);
  },
}));

const { default: handler } = await import("../src/commands/plugins/zoom/index");

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

describe("zoom plugin", () => {
  it("CLI — missing target returns usage", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("CLI — happy path toggles zoom", async () => {
    const { ctx, out } = cliCtx(["mawjs-view"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("zoom mawjs-view");
  });

  it("CLI — --pane appends .N", async () => {
    const { ctx, out } = cliCtx(["mawjs-view", "--pane", "1"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("zoom mawjs-view.1");
  });

  it("CLI — session:window preserved", async () => {
    const { ctx, out } = cliCtx(["mawjs-view:0"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("zoom mawjs-view:0");
  });

  it("CLI — not found errors", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["nope-xyz"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("CLI — ambiguous lists candidates", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["ambi"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ambiguous");
  });

  it("API — missing target errors", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("target is required");
  });

  it("API — target + pane ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { target: "mawjs-view", pane: 2 } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("zoom mawjs-view.2");
  });
});
