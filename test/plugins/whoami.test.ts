import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../../src/plugin/types";

mock.module(join(import.meta.dir, "../../src/sdk"), () => ({
  hostExec: async () => "mawjs-view\n",
}));

const { default: whoami } = await import("../../src/commands/plugins/whoami/index");
const { default: session } = await import("../../src/commands/plugins/session/index");

describe("whoami plugin", () => {
  const origExit = process.exit;
  const origTmux = process.env.TMUX;
  beforeEach(() => { (process as any).exit = (c?: number) => { throw new Error(`exit ${c ?? 0}`); }; });
  afterEach(() => {
    process.exit = origExit;
    if (origTmux === undefined) delete process.env.TMUX; else process.env.TMUX = origTmux;
  });

  const ctx: InvokeContext = { source: "cli", args: [] };

  it("prints trimmed session name when TMUX is set", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,1,0";
    const r = await whoami(ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toBe("mawjs-view");
  });

  it("errors cleanly outside tmux (no crash)", async () => {
    delete process.env.TMUX;
    const r = await whoami(ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("requires an active tmux session");
  });

  it("`maw session` alias delegates to same impl", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,1,0";
    const r = await session(ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toBe("mawjs-view");
  });
});
