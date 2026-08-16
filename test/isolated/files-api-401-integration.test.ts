/**
 * ยิงของจริงผ่าน middleware แล้ว **ดู 401 กับ body ด้วยตา** ไม่ใช่ดู exit code
 *
 * 📎 เงื่อนไขข้อ 2 ของแม่ labubu 16.08: "อย่าตรวจด้วย exit code ถ้า exit code
 *    เท่ากันทั้งสองสถานะ ⇒ ต้องเห็น 401 กับ body reason"
 *
 * Why isolated: ต้อง mock.module `../../src/config` ซึ่ง bun ทำเป็น process-global
 *
 * ⚠️ ของที่เทสต์นี้ **ไม่ได้** พิสูจน์: request ที่มาทาง nginx จะมี TCP source เป็น
 *    127.0.0.1 โดยชอบธรรม (Path B ที่ elysia-auth.ts:266-274 เขียนเตือนไว้เอง)
 *    ⇒ ด่านนี้ปิด "ยิงเข้าพอร์ตแอปตรงจากนอกเครื่อง" ไม่ได้ปิดทางผ่าน nginx
 */
import { describe, expect, test, mock } from "bun:test";
import { join } from "path";
import { mockConfigModule } from "../helpers/mock-config";

const srcRoot = join(import.meta.dir, "../..");

mock.module(join(srcRoot, "src/config"), () =>
  mockConfigModule(() => ({ host: "local", federationToken: "test-token-16chars!" })),
);

const { federationAuth, setBunServer } = await import("../../src/lib/elysia-auth");
const { Elysia } = await import("elysia");

/** จำลอง client ที่ไม่ใช่ loopback — IP ในช่วงเอกสาร RFC5737 */
function serveFrom(address: string) {
  setBunServer({ requestIP: () => ({ address }) } as any);
}

function app() {
  return new Elysia()
    .use(federationAuth)
    .get("/api/files", () => ["a.html", "b.html"])
    .get("/api/files/:name", () => "<html>ไบต์ของไฟล์จริง</html>")
    .delete("/api/files/:name", () => ({ ok: true }))
    .get("/api/sessions", () => [{ name: "volt" }]);
}

describe("/api/files ผ่าน middleware จริง", () => {
  test("client นอกเครื่อง: GET ไฟล์ → 401 และ body บอกเหตุผล", async () => {
    serveFrom("203.0.113.9");
    const res = await app().handle(new Request("http://node/api/files/session-morse-90ea18d5.html"));
    const body = await res.json();

    expect(res.status).toBe(401);                     // ← เห็นเลขจริง
    expect(body.reason).toBe("missing_signature");    // ← เห็นเหตุผลจริง
    expect(JSON.stringify(body)).not.toContain("ไบต์ของไฟล์จริง"); // ← เนื้อไฟล์ต้องไม่ออกไป
  });

  test("client นอกเครื่อง: GET รายการไฟล์ → 401 (ไม่ให้รู้ว่ามีไฟล์อะไรอยู่)", async () => {
    serveFrom("203.0.113.9");
    const res = await app().handle(new Request("http://node/api/files"));
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("missing_signature");
  });

  test("client นอกเครื่อง: DELETE ไฟล์ → 401", async () => {
    serveFrom("203.0.113.9");
    const res = await app().handle(new Request("http://node/api/files/pane-history.html", { method: "DELETE" }));
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("missing_signature");
  });

  test("near-miss: /sessions จากที่เดียวกัน ต้อง **ไม่** 401 — ด่านต้องแคบ", async () => {
    serveFrom("203.0.113.9");
    const res = await app().handle(new Request("http://node/api/sessions"));
    expect(res.status).toBe(200);
  });

  test("loopback ยังผ่านได้ — CLI ในเครื่องและ UI ผ่าน nginx ต้องไม่พัง", async () => {
    serveFrom("127.0.0.1");
    const res = await app().handle(new Request("http://node/api/files/pane-history.html"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ไบต์ของไฟล์จริง");
  });
});
