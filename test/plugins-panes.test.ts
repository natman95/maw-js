import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../src/plugin/types";

const root = join(import.meta.dir, "../src");

interface CallRecord { target?: string; opts: { pid?: boolean; all?: boolean } }
const calls: CallRecord[] = [];

mock.module(join(root, "commands/plugins/panes/impl"), () => ({
  cmdPanes: async (target?: string, opts: { pid?: boolean; all?: boolean } = {}) => {
    calls.push({ target, opts });
    if (target === "ambi") {
      console.error("✗ 'ambi' is ambiguous");
      throw new Error("exit 1");
    }
    if (target === "nope-xyz") {
      console.error("✗ session 'nope-xyz' not found");
      throw new Error("exit 1");
    }
    if (opts.all && target) console.log("⚠ --all ignores target argument");
    const header = opts.pid ? "TARGET  SIZE  PID  COMMAND  TITLE" : "TARGET  SIZE  COMMAND  TITLE";
    console.log(header);
    if (opts.all) {
      console.log(`alpha:0.0  80x24  ${opts.pid ? "111  " : ""}zsh  ready`);
      console.log(`beta:1.0   80x24  ${opts.pid ? "222  " : ""}claude  busy`);
    } else {
      console.log(`${target ?? "current"}:0.0  80x24  ${opts.pid ? "111  " : ""}zsh  ready`);
    }
  },
}));

const { default: handler } = await import("../src/commands/plugins/panes/index");

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

describe("panes plugin", () => {
  it("CLI — no target lists current window panes", async () => {
    const { ctx, out } = cliCtx([]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    const output = result.output ?? out();
    expect(output).toContain("TARGET");
    expect(output).toContain("current:0.0");
  });

  it("CLI — session target listed", async () => {
    const { ctx, out } = cliCtx(["mawjs-view"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? out()).toContain("mawjs-view:0.0");
  });

  it("CLI — flag-looking arg rejected", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--weird"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("looks like a flag");
  });

  it("CLI — target not found reports error", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["nope-xyz"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("CLI — ambiguous target errors", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["ambi"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ambiguous");
  });

  it("API — no target ok", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("TARGET");
  });

  it("API — explicit target ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { target: "mawjs-view" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("mawjs-view:0.0");
  });

  it("CLI — --all passes all=true to cmdPanes", async () => {
    calls.length = 0;
    const { ctx, out } = cliCtx(["--all"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(calls[0]!.opts.all).toBe(true);
    expect(calls[0]!.target).toBeUndefined();
    const output = result.output ?? out();
    expect(output).toContain("alpha:0.0");
    expect(output).toContain("beta:1.0");
  });

  it("CLI — -a alias behaves identically to --all", async () => {
    calls.length = 0;
    const { ctx, out } = cliCtx(["-a"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(calls[0]!.opts.all).toBe(true);
    expect(result.output ?? out()).toContain("alpha:0.0");
  });

  it("CLI — --all composes with --pid", async () => {
    calls.length = 0;
    const { ctx, out } = cliCtx(["--all", "--pid"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(calls[0]!.opts.all).toBe(true);
    expect(calls[0]!.opts.pid).toBe(true);
    expect(result.output ?? out()).toContain("PID");
  });

  it("CLI — --all + target warns and still shows all panes", async () => {
    calls.length = 0;
    const { ctx, out } = cliCtx(["mawjs", "--all"]);
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(calls[0]!.opts.all).toBe(true);
    expect(calls[0]!.target).toBe("mawjs");
    const output = result.output ?? out();
    expect(output).toContain("--all ignores target");
    expect(output).toContain("alpha:0.0");
  });

  it("API — all=true routes to --all mode", async () => {
    calls.length = 0;
    const ctx: InvokeContext = { source: "api", args: { all: true } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(calls[0]!.opts.all).toBe(true);
    expect(result.output).toContain("alpha:0.0");
  });
});
