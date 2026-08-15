import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as netConnect } from "node:net";

const original = {
  cwd: process.cwd(),
  home: process.env.HOME,
  mawHome: process.env.MAW_HOME,
  pluginsDir: process.env.MAW_PLUGINS_DIR,
  hotReload: process.env.MAW_HOT_RELOAD,
  gateway: process.env.MAW_GATEWAY,
  verbosity: process.env.MAW_SERVE_VERBOSITY,
  cli: process.env.MAW_CLI,
};

let root = "";

type BunServerLike = { port: number; stop: (force?: boolean) => void };

/** ยิง HTTP upgrade ดิบ ๆ แล้วคืน "ส่วนหัวของคำตอบ" ทั้งก้อน เพื่ออ่าน header ที่เจรจาได้จริง */
function rawUpgradeHeaders(port: number, path: string, extensions: string, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, "127.0.0.1", () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        (extensions ? `Sec-WebSocket-Extensions: ${extensions}\r\n` : "") +
        "\r\n",
      );
    });
    let buf = "";
    const done = (fn: () => void) => { clearTimeout(timer); sock.destroy(); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error(`handshake timeout after ${timeoutMs}ms`))), timeoutMs);
    sock.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const end = buf.indexOf("\r\n\r\n");
      if (end >= 0) done(() => resolve(buf.slice(0, end)));
    });
    sock.on("error", (e) => done(() => reject(e)));
  });
}

function restoreEnv(key: keyof typeof original, envName: keyof NodeJS.ProcessEnv): void {
  const value = original[key];
  if (value === undefined) delete process.env[envName];
  else process.env[envName] = value;
}

function waitForOpen(ws: WebSocket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      try { ws.close(); } catch { /* best effort */ }
      reject(new Error(`websocket did not open within ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };
    const onOpen = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("websocket errored before open")); };
    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onError, { once: true });
  });
}

function waitForJsonFrame(ws: WebSocket, predicate: (value: any) => boolean, timeoutMs = 5_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`websocket frame did not arrive within ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };
    const onMessage = (event: MessageEvent) => {
      const text = typeof event.data === "string" ? event.data : String(event.data);
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { return; }
      if (!predicate(parsed)) return;
      cleanup();
      resolve(parsed);
    };
    const onError = () => { cleanup(); reject(new Error("websocket errored while waiting for frame")); };
    const onClose = () => { cleanup(); reject(new Error("websocket closed before expected frame")); };
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError, { once: true });
    ws.addEventListener("close", onClose, { once: true });
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "maw-real-serve-smoke-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "plugins"), { recursive: true });
  mkdirSync(join(root, "cwd"), { recursive: true });
  process.chdir(join(root, "cwd"));

  process.env.HOME = join(root, "home");
  process.env.MAW_HOME = join(root, "home", ".maw");
  process.env.MAW_PLUGINS_DIR = join(root, "plugins");
  process.env.MAW_HOT_RELOAD = "0";
  process.env.MAW_GATEWAY = "bun";
  process.env.MAW_SERVE_VERBOSITY = "0";
  process.env.MAW_CLI = "1";
});

afterEach(() => {
  process.chdir(original.cwd);
  restoreEnv("home", "HOME");
  restoreEnv("mawHome", "MAW_HOME");
  restoreEnv("pluginsDir", "MAW_PLUGINS_DIR");
  restoreEnv("hotReload", "MAW_HOT_RELOAD");
  restoreEnv("gateway", "MAW_GATEWAY");
  restoreEnv("verbosity", "MAW_SERVE_VERBOSITY");
  restoreEnv("cli", "MAW_CLI");
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("startServer real Bun.serve smoke (#2749)", () => {
  test("serves real HTTP and upgrades a real WebSocket route", async () => {
    const { startServer } = await import("../../src/core/server.ts?real-bunserve-smoke");
    let server: BunServerLike | undefined;
    let ws: WebSocket | undefined;

    try {
      server = await startServer(0, {
        transports: [],
        intervals: false,
        views: false,
        apiRouters: [],
      }, { verbosity: 0, gateway: "bun" }) as BunServerLike;

      expect(server.port).toBeGreaterThan(0);
      const origin = `http://127.0.0.1:${server.port}`;

      const http = await fetch(`${origin}/api/feed?limit=1`);
      expect(http.status).toBe(200);
      await expect(http.json()).resolves.toMatchObject({ events: expect.any(Array) });

      ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      await waitForOpen(ws);
      const frame = await waitForJsonFrame(ws, (value) => value?.type === "feed-history");
      expect(frame).toMatchObject({ type: "feed-history", events: expect.any(Array) });
    } finally {
      if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
      server?.stop(true);
    }
  }, 10_000);

  // อ่าน "สิ่งที่เซิร์ฟเวอร์ตอบกลับใน handshake" ไม่ใช่ "จอยังขึ้นอยู่ไหม" (📎 Labubu 16.08)
  // ท่าเดียวที่พิสูจน์ได้ว่าการบีบอัดถูกเจรจาสำเร็จจริง คือ header ที่ตอบกลับมา
  test("handshake ตอบรับ permessage-deflate เมื่อ client ขอ (และไม่ยัดให้เมื่อไม่ขอ)", async () => {
    const { startServer } = await import("../../src/core/server.ts?ws-deflate-handshake");
    let server: BunServerLike | undefined;
    try {
      server = await startServer(0, {
        transports: [], intervals: false, views: false, apiRouters: [],
      }, { verbosity: 0, gateway: "bun" }) as BunServerLike;

      const asked = await rawUpgradeHeaders(server.port, "/ws", "permessage-deflate");
      expect(asked).toContain("101");
      expect(asked.toLowerCase()).toContain("sec-websocket-extensions: permessage-deflate");

      // negative control: ไม่ขอ ⇒ ต้องไม่มีในคำตอบ — กันเทสต์ที่ผ่านเพราะ assert หลวม
      const notAsked = await rawUpgradeHeaders(server.port, "/ws", "");
      expect(notAsked).toContain("101");
      expect(notAsked.toLowerCase()).not.toContain("sec-websocket-extensions: permessage-deflate");
    } finally {
      server?.stop(true);
    }
  }, 10_000);
});
