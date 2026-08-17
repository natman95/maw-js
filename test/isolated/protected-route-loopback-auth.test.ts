// เส้นทางใน PROTECTED ต้องเปิดให้ loopback และปิดให้คนอื่น
//
// 🔴 บั๊กที่เทสต์ชุดนี้ถือไว้ (16.08): `api.handle(req.clone())` ใน core/server.ts
//    Request ที่ clone มาไม่ผูกกับ TCP connection เดิม ⇒ `server.requestIP(cloned)` คืน null
//    ⇒ `isLoopback(null)` เป็นเท็จ ⇒ ด่านตอบ 401 ให้ **ทุกคน รวมทั้ง loopback เอง**
//    วัดจริงก่อนแก้: 10 เส้นทางใน PROTECTED ตอบ 401 ให้ curl จาก 127.0.0.1
//
// ทำไมเทสต์เดิม 1358 ข้อไม่เห็น: ไม่มีข้อไหนบูต Bun.serve จริงแล้วยิงเส้นทาง PROTECTED
// จาก loopback — ด่านถูกทดสอบที่ระดับฟังก์ชัน (isLoopback / verify) ซึ่งไม่มี clone มาเกี่ยว
//
// ⚠️ ทุกเป้าในไฟล์นี้เป็นชื่อที่ไม่มีอยู่จริง — ไม่มีข้อไหนแตะ pane/session ของจริง

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

const SAFE_TARGET = "__probe-nonexistent-9f3a__";

const original = {
  cwd: process.cwd(),
  home: process.env.HOME,
  mawHome: process.env.MAW_HOME,
  configDir: process.env.MAW_CONFIG_DIR,
  pluginsDir: process.env.MAW_PLUGINS_DIR,
  hotReload: process.env.MAW_HOT_RELOAD,
  gateway: process.env.MAW_GATEWAY,
  verbosity: process.env.MAW_SERVE_VERBOSITY,
  cli: process.env.MAW_CLI,
  testMode: process.env.MAW_TEST_MODE,
};

// 🔴 ต้องตั้งทั้งหมดนี้ **ที่ระดับโมดูล** ไม่ใช่ใน beforeEach:
//    src/core/paths.ts คำนวณ CONFIG_FILE เป็น const ตอน import ครั้งแรกครั้งเดียว
//    ⇒ เขียนคอนฟิกใน beforeEach ของเทสต์ข้อที่ 2 เป็นต้นไป "ไม่ทัน" — ผมเจอมาแล้ว
//    อาการคือ bind ไม่เปลี่ยน แล้วยิงเข้า IP ของการ์ดได้ ConnectionRefused
const root = mkdtempSync(join(tmpdir(), "maw-protected-loopback-"));
mkdirSync(join(root, "home", ".maw", "config"), { recursive: true });
mkdirSync(join(root, "plugins"), { recursive: true });
mkdirSync(join(root, "cwd"), { recursive: true });

process.env.HOME = join(root, "home");
process.env.MAW_HOME = join(root, "home", ".maw");
process.env.MAW_CONFIG_DIR = join(root, "home", ".maw");
process.env.MAW_PLUGINS_DIR = join(root, "plugins");
process.env.MAW_HOT_RELOAD = "0";
process.env.MAW_GATEWAY = "bun";
process.env.MAW_SERVE_VERBOSITY = "0";
process.env.MAW_CLI = "1";           // ⚠️ ไม่ตั้ง = แค่ import server.ts ก็บูตเซิร์ฟเวอร์ที่ 3456
process.env.MAW_TEST_MODE = "1";

// 🔴 ตัวแปรชี้ขาด: ด่านทั้งสองชั้นขึ้นต้นด้วย `if (!config.federationToken) return;`
//    ไม่มี token = ด่านปิดตัวเอง = เทสต์เขียวโดยไม่มีอะไรถูกทดสอบ (เขียวเพราะไม่มีด่าน)
//    bind 0.0.0.0 จำเป็นสำหรับทิศลบ — พอร์ตสุ่มและ ufw ไม่เปิดพอร์ตสูงจากภายนอก
writeFileSync(
  join(root, "home", ".maw", "config", "maw.config.json"),
  JSON.stringify({ node: "test-node", bind: "0.0.0.0", federationToken: "test-only-token-0123456789" }),
);

type BunServerLike = { port: number; stop: (force?: boolean) => void };

function restoreEnv(key: keyof typeof original, envName: string): void {
  const value = original[key];
  if (value === undefined) delete process.env[envName];
  else process.env[envName] = value as string;
}

/** IPv4 ของการ์ดจริงใบแรก (ไม่ใช่ loopback) — ใช้ยิงทิศลบ */
function firstExternalIpv4(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}

beforeEach(() => {
  process.chdir(join(root, "cwd"));
  // 🔴 afterEach คืนค่า env เป็นของเดิม ซึ่ง "ของเดิม" ของ MAW_CLI คือ **ไม่มี**
  //    ⇒ import server.ts รอบถัดไปจะวิ่งเข้า `if (!process.env.MAW_CLI) startServer()`
  //    แล้วไปแย่งพอร์ต 3456 ของเซิร์ฟเวอร์ตัวจริงบนเครื่อง — ผมเจอมาแล้วในรอบพัฒนา
  process.env.HOME = join(root, "home");
  process.env.MAW_HOME = join(root, "home", ".maw");
  process.env.MAW_CONFIG_DIR = join(root, "home", ".maw");
  process.env.MAW_PLUGINS_DIR = join(root, "plugins");
  process.env.MAW_GATEWAY = "bun";
  process.env.MAW_SERVE_VERBOSITY = "0";
  process.env.MAW_CLI = "1";
  process.env.MAW_TEST_MODE = "1";
});

afterEach(() => {
  process.chdir(original.cwd);
  restoreEnv("home", "HOME");
  restoreEnv("mawHome", "MAW_HOME");
  restoreEnv("configDir", "MAW_CONFIG_DIR");
  restoreEnv("pluginsDir", "MAW_PLUGINS_DIR");
  restoreEnv("hotReload", "MAW_HOT_RELOAD");
  restoreEnv("gateway", "MAW_GATEWAY");
  restoreEnv("verbosity", "MAW_SERVE_VERBOSITY");
  restoreEnv("cli", "MAW_CLI");
  restoreEnv("testMode", "MAW_TEST_MODE");
});

describe("PROTECTED routes over a real Bun.serve", () => {
  test("ด่านติดจริงก่อนอ่านผล — ไม่มี token = เทสต์ทั้งไฟล์ไม่มีความหมาย", async () => {
    const { loadConfig } = await import("../../src/config/load.ts?protected-loopback-gate");
    expect(loadConfig().federationToken).toBeTruthy();
  });

  test("loopback ยิงเส้นทาง PROTECTED แล้วต้องไม่โดน 401", async () => {
    const { startServer } = await import("../../src/core/server.ts?protected-loopback");
    let server: BunServerLike | undefined;
    try {
      server = await startServer(0, { transports: [], intervals: false, views: false });
      const res = await fetch(`http://127.0.0.1:${server!.port}/api/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      // 401 = ด่านปฏิเสธเจ้าของเครื่องเอง — นี่คืออาการของบั๊ก req.clone()
      expect(res.status).not.toBe(401);
    } finally {
      server?.stop(true);
    }
  });

  test("IP ที่ไม่ใช่ loopback ต้องยังโดน 401 — แพตช์คืนสิทธิ์ให้ loopback ไม่ใช่เปิดให้ทุกคน", async () => {
    const external = firstExternalIpv4();
    // ไม่มีการ์ดจริง = ยิงทิศนี้ไม่ได้ ⇒ ประกาศออกมาตรง ๆ ว่าไม่ได้ทดสอบ ไม่ใช่ปล่อยเขียวเงียบ ๆ
    expect(typeof external === "string" || external === undefined).toBe(true);
    if (!external) {
      console.warn("[protected-loopback] ⚠️ ไม่มี IPv4 ที่ไม่ใช่ loopback บนเครื่องนี้ — ทิศลบ UNVERIFIED");
      return;
    }
    const { startServer } = await import("../../src/core/server.ts?protected-nonloopback");
    let server: BunServerLike | undefined;
    try {
      server = await startServer(0, { transports: [], intervals: false, views: false });
      const res = await fetch(`http://${external}:${server!.port}/api/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);

      // control ทิศตรงข้าม: เส้นทางสาธารณะต้องยัง 200 จาก IP เดียวกัน
      // ไม่งั้น 401 ข้างบนอาจแปลว่า "เซิร์ฟเวอร์พังทั้งอัน" ไม่ใช่ "ด่านทำงาน" (📎 morse 16.08)
      const publicRes = await fetch(`http://${external}:${server!.port}/api/sessions`);
      expect(publicRes.status).toBe(200);
    } finally {
      server?.stop(true);
    }
  });

  test("เส้นทางที่ปลั๊กอินเสิร์ฟยังอ่าน body ได้ หลังตัวจริงถูกส่งเข้าด่าน", async () => {
    // near-miss ของแพตช์นี้โดยตรง: สำเนามีไว้เพราะ api.handle() กิน body
    // ถ้าสลับผิดทาง ฝั่งปลั๊กอินจะได้ใบที่ถูกอ่านไปแล้ว ⇒ อ่าน body ไม่ออก
    // /api/triggers/fire อยู่ใน PROTECTED และเสิร์ฟโดยปลั๊กอิน serve-triggers-mutate
    const { startServer } = await import("../../src/core/server.ts?protected-plugin-body");
    let server: BunServerLike | undefined;
    try {
      server = await startServer(0, { transports: [], intervals: false, views: false });
      const res = await fetch(`http://127.0.0.1:${server!.port}/api/triggers/fire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: SAFE_TARGET }),
      });
      const text = await res.text();
      // ไม่ใช่ 401 (ด่านไม่ได้ปฏิเสธ) และไม่ใช่ "event is required" (แปลว่า body ถึงมือปลั๊กอินจริง)
      expect(res.status).not.toBe(401);
      expect(text).not.toContain("event is required");
    } finally {
      server?.stop(true);
    }
  });
});

describe("ต้นตอ: Request ที่ clone แล้วไม่มี IP ให้ถาม", () => {
  test("requestIP(ตัวจริง) มีค่า แต่ requestIP(สำเนา) เป็น null", async () => {
    let captured: { direct: unknown; cloned: unknown } | undefined;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        captured = {
          direct: srv.requestIP(req)?.address ?? null,
          cloned: srv.requestIP(req.clone())?.address ?? null,
        };
        return new Response("ok");
      },
    });
    try {
      await fetch(`http://127.0.0.1:${server.port}/`);
      expect(captured?.direct).toBe("127.0.0.1");
      expect(captured?.cloned).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
