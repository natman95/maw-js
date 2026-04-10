import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks ---

let sshResult = "";
let sshCommands: string[] = [];

let mockSessions: any[] = [];

// Engine tests disabled: Bun mock.module() is global and pollutes findWindow/tmux
// for other test files. These need isolated test runs or a mock refactor.
// TODO: Move to test/engine.isolated.test.ts with --preload mock
const MawEngine = null as any;

/** Minimal WebSocket stub that records sent messages */
function makeWS(): { ws: any; messages: any[] } {
  const messages: any[] = [];
  const ws = {
    data: { target: null, previewTargets: new Set() },
    send: (msg: string) => messages.push(JSON.parse(msg)),
  };
  return { ws, messages };
}

describe.todo("MawEngine — needs isolated test runner (mock.module pollutes globals)", () => {
  beforeEach(() => {
    sshResult = "";
    sshCommands = [];
    mockSessions = [];
  });

  describe("handleOpen — no stale recent agents", () => {
    test.todo("warm cache sends sessions instantly without recent message — needs full tmux+peers mock", async () => {
      mockSessions = [
        { name: "oracles", windows: [{ index: 1, name: "pulse-oracle", active: true }] },
      ];

      const engine = new MawEngine({ feedBuffer: [], feedListeners: new Set() });

      // Simulate warm cache by setting it via broadcastSessions flow
      // @ts-ignore — access private for testing
      engine.sessionCache = { sessions: mockSessions, json: "" };

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);

      await new Promise(r => setTimeout(r, 200));

      // Should send sessions + feed-history, but NOT recent
      const types = messages.map(m => m.type);
      expect(types).toContain("sessions");
      expect(types).toContain("feed-history");
      expect(types).not.toContain("recent"); // <-- the bug fix
    });

    test.todo("cold cache fetches via tmux.listAll, no recent message — needs full tmux+peers mock", async () => {
      mockSessions = [
        { name: "oracles", windows: [{ index: 1, name: "pulse-oracle", active: true }] },
        { name: "hermes", windows: [{ index: 1, name: "hermes-oracle", active: false }] },
      ];

      const engine = new MawEngine({ feedBuffer: [], feedListeners: new Set() });

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);

      // Wait for async listAll to resolve
      await new Promise(r => setTimeout(r, 200));

      const types = messages.map(m => m.type);
      expect(types).toContain("sessions");
      expect(types).toContain("feed-history");
      expect(types).not.toContain("recent"); // <-- no stale recent
    });
  });

  describe("handleOpen — sends recent for busy agents", () => {
    test.todo("sends recent message when agents are running claude — needs full tmux+peers mock", async () => {
      sshResult = "claude";
      mockSessions = [
        { name: "oracles", windows: [{ index: 1, name: "pulse-oracle", active: true }] },
      ];

      const engine = new MawEngine({ feedBuffer: [], feedListeners: new Set() });

      // @ts-ignore — access private for testing
      engine.sessionCache = { sessions: mockSessions, json: "" };

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);

      // Wait for async getPaneCommands to resolve
      await new Promise(r => setTimeout(r, 200));

      const recent = messages.find(m => m.type === "recent");
      expect(recent).toBeDefined();
      expect(recent!.agents).toHaveLength(1);
      expect(recent!.agents[0].target).toBe("oracles:1");
      expect(recent!.agents[0].name).toBe("pulse-oracle");
      expect(recent!.agents[0].session).toBe("oracles");
    });

    test("no recent message when all agents are idle", async () => {
      sshResult = "zsh";
      mockSessions = [
        { name: "oracles", windows: [{ index: 1, name: "pulse-oracle", active: true }] },
      ];

      const engine = new MawEngine({ feedBuffer: [], feedListeners: new Set() });

      // @ts-ignore — access private for testing
      engine.sessionCache = { sessions: mockSessions, json: "" };

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);

      await new Promise(r => setTimeout(r, 200));

      const types = messages.map(m => m.type);
      expect(types).not.toContain("recent");
    });
  });

  describe("broadcastSessions — no terminal scraping", () => {
    test.todo("broadcasts sessions without recent message — needs full tmux+peers mock", async () => {
      mockSessions = [{ name: "oracles", windows: [{ index: 1, name: "pulse-oracle", active: true }] }];

      
      const engine = new MawEngine({ feedBuffer: [], feedListeners: new Set() });

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);
      messages.length = 0; // clear initial messages

      // Trigger broadcast
      // @ts-ignore — access private for testing
      await engine.broadcastSessions();

      const types = messages.map(m => m.type);
      // Should only send sessions (if changed), never recent
      expect(types).not.toContain("recent");

      // Should NOT have spawned capture commands for terminal scraping
      const captureCommands = sshCommands.filter(c => c.includes("capture-pane"));
      expect(captureCommands.length).toBe(0);
    });

    test.todo("uses single tmux list-windows -a command — needs full tmux+peers mock", async () => {
      mockSessions = [
        { name: "oracles", windows: [{ index: 1, name: "pulse-oracle", active: true }, { index: 2, name: "volt-oracle", active: false }] },
      ];

      
      const engine = new MawEngine({ feedBuffer: [], feedListeners: new Set() });

      const { ws } = makeWS();
      engine.handleOpen(ws as any);

      // Wait for cold fetch
      await new Promise(r => setTimeout(r, 200));

      // Should use list-windows -a (single command), not list-sessions + N list-windows
      const listWindowsCmds = sshCommands.filter(c => c.includes("list-windows"));
      expect(listWindowsCmds.length).toBe(1);
      expect(listWindowsCmds[0]).toContain("-a");
    });
  });
});
