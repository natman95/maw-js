import { describe, expect, test } from "bun:test";
import { isProtected } from "../src/lib/elysia-auth";

/**
 * `/files` ต้องอยู่ในชุด PROTECTED
 *
 * 🔍 เคสต้นเรื่อง 2026-08-16 บน srv1809016 — morse ยิงเองแล้วได้ 200:
 *      GET http://127.0.0.1:3456/api/files/session-morse-90ea18d5-….html  → 200 · 47,625 B
 *      GET http://187.127.96.120:3456/api/files/…                          → 200 · เท่ากัน
 *    ของที่หลุดคือ transcript บทสนทนางานจริง
 *
 * ⚠️ รูปทั้งหมดในไฟล์นี้ **ยกมาจากทราฟฟิกจริง** ไม่ได้แต่งขึ้น
 *    (📎 near-miss ที่แต่งเองสืบทอดจุดบอดของคนแต่ง)
 *      · GET /files/…                  — ผมยิงเองตอนตรวจว่าหน้าเสิร์ฟได้ไหม
 *      · GET /files                    — morse ยิงตอนตรวจว่าเหลือไฟล์ไหม
 *      · GET /sessions                 — ผมยิงข้ามโหนดตอนหาว่า labubu อยู่จอไหน
 *      · GET /capture?target=…&lines=  — pane-history.html เรียกจริง (บรรทัด 111,125)
 *      · POST /feed / GET /feed        — สตรีมที่ /ws ส่ง feed-history ตอน connect
 *
 * path ที่ส่งเข้า isProtected ถูกตัด `/api` ออกแล้ว (elysia-auth.ts:274)
 */

describe("isProtected — /files ต้องมีด่าน", () => {
  // ── ≥4 รูปของ defect: ต้องคืน true ทุกอัน ──
  test("GET /files — ลิสต์ชื่อไฟล์ทั้งกล่อง = การค้นพบว่ามีอะไรอยู่", () => {
    expect(isProtected("/files", "GET")).toBe(true);
  });

  test("GET /files/:name — เสิร์ฟไบต์เต็มของไฟล์ผู้ใช้ (เคสต้นเรื่อง)", () => {
    expect(isProtected("/files/session-morse-90ea18d5-6d4e.html", "GET")).toBe(true);
  });

  test("DELETE /files/:name — เป็นการเขียน ตามกฎที่ไฟล์นี้ประกาศเอง", () => {
    expect(isProtected("/files/pane-history.html", "DELETE")).toBe(true);
  });

  test("path ที่พยายามหลบด้วย .. หรือ encoded ก็ยังต้องติดด่าน", () => {
    expect(isProtected("/files/../../etc/passwd", "GET")).toBe(true);
    expect(isProtected("/files/..%2F..%2Fetc%2Fpasswd", "GET")).toBe(true);
    expect(isProtected("/files/%2e%2e/secret.env", "GET")).toBe(true);
  });

  test("เมธอดอื่นบน /files ก็ต้องติด — ไม่ใช่ allowlist ราย method", () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(isProtected("/files/x.html", m)).toBe(true);
    }
  });

  // ── ≥5 รูป near-miss: ต้องเงียบ (คืน false) ──
  test("near-miss ที่ต้องเงียบ — metadata สาธารณะที่ UI ใช้จริง", () => {
    expect(isProtected("/sessions", "GET")).toBe(false);
    expect(isProtected("/capture", "GET")).toBe(false);
    expect(isProtected("/mirror", "GET")).toBe(false);
    expect(isProtected("/plugin/list-manifest", "GET")).toBe(false);
    expect(isProtected("/feed", "GET")).toBe(false);
  });

  test("near-miss ที่ต้องเงียบ — เส้นทางที่ชื่อขึ้นต้นคล้าย /files แต่คนละของ", () => {
    // ห้ามให้ prefix match กว้างเกินจนกินเส้นทางอื่น
    expect(isProtected("/filesystem-status", "GET")).toBe(false);
    expect(isProtected("/fileserver", "GET")).toBe(false);
  });

  // ── ของเดิมต้องไม่เปลี่ยนพฤติกรรม ──
  test("ด่านเดิมยังอยู่ครบ — แพตช์นี้เพิ่ม ไม่ได้ย้าย", () => {
    expect(isProtected("/send", "POST")).toBe(true);
    expect(isProtected("/wake", "POST")).toBe(true);
    expect(isProtected("/control/kill", "POST")).toBe(true);
    expect(isProtected("/plugin/download/foo.tgz", "GET")).toBe(true);
    expect(isProtected("/feed", "POST")).toBe(true);
  });
});
