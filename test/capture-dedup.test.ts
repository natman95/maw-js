import { describe, expect, test } from "bun:test";
import { collapseRedraws } from "../src/engine/capture-dedup";

const FRAME = ["✻ Baked for 1m 33s", "❯ เสร็จแล้ว /wrap นะ", "  Ran 2 shell commands", "● Stopping the packet capture"];

describe("collapseRedraws", () => {
  test("collapses the EARLIER copy and keeps the newest paint", () => {
    const src = [...FRAME, "unique-between", ...FRAME, "unique-tail"].join("\n");
    const r = collapseRedraws(src, 4);

    expect(r.collapsed).toBe(1);
    expect(r.linesSaved).toBe(4);

    const out = r.text.split("\n");
    // ลำดับต้องเป็น: marker → unique-between → เฟรม → unique-tail
    // ถ้าเก็บอันแรกไว้แทน ลำดับจะกลับด้าน (เฟรมมาก่อน unique-between)
    expect(out[0]).toContain("collapsed 4 duplicate lines");
    expect(out[1]).toBe("unique-between");
    expect(out.slice(2, 6)).toEqual(FRAME);
    expect(out.at(-1)).toBe("unique-tail");
  });

  test("marker keeps the collapse visible — nothing vanishes silently", () => {
    const src = [...FRAME, "x", ...FRAME, "y"].join("\n");
    const markers = collapseRedraws(src, 4).text.split("\n").filter(l => l.includes("⋯"));
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatch(/collapsed \d+ duplicate lines/);
  });

  test("leaves runs shorter than minBlock alone", () => {
    const src = ["a", "b", "z", "a", "b"].join("\n");
    const r = collapseRedraws(src, 4);
    expect(r.collapsed).toBe(0);
    expect(r.text).toBe(src);
  });

  test("does not collapse blank-heavy blocks (needs ≥2 non-blank lines)", () => {
    const src = ["a", "", "", "", "q", "a", "", "", "", "w"].join("\n");
    const r = collapseRedraws(src, 4);
    expect(r.collapsed).toBe(0);
    expect(r.text).toBe(src);
  });

  test("minBlock 0 disables the pass entirely", () => {
    const src = [...FRAME, "x", ...FRAME].join("\n");
    expect(collapseRedraws(src, 0)).toEqual({ text: src, collapsed: 0, linesSaved: 0 });
  });

  test("all-unique content comes back byte-identical", () => {
    const src = Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n");
    const r = collapseRedraws(src, 4);
    expect(r.text).toBe(src);
    expect(r.collapsed).toBe(0);
  });

  test("never removes more than the duplicates — distinct lines all survive", () => {
    const src = [...FRAME, "a1", ...FRAME, "a2", ...FRAME, "a3"].join("\n");
    const r = collapseRedraws(src, 4);
    const before = new Set(src.split("\n").filter(l => l.trim()));
    const after = new Set(r.text.split("\n").filter(l => l.trim() && !l.includes("⋯")));
    for (const line of before) expect(after.has(line)).toBe(true);
    expect(r.collapsed).toBeGreaterThan(0);
  });

  test("only byte-identical lines fuse — a differing spinner line is not normalised away", () => {
    const a = [...FRAME, "· Infusing… (23s)"];
    const b = [...FRAME, "· Infusing… (35s)"];
    const r = collapseRedraws([...a, "gap", ...b].join("\n"), 4);
    // เฟรม 4 บรรทัดยุบได้ แต่บรรทัดตัวหมุนสองค่าต้องอยู่ครบทั้งคู่
    expect(r.text).toContain("(23s)");
    expect(r.text).toContain("(35s)");
  });
});
