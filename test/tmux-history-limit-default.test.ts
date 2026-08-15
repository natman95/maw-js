import { describe, expect, test } from "bun:test";
import { Tmux } from "../src/core/transport/tmux-class";
import { cfgLimit } from "../src/config";

// ชุดเงียบของกลไก history-limit (📎 Boss เคาะ 15.08.2026 · labubu ขอชุดนี้เป็นเงื่อนไขของ PR)
//
// ทุกข้อในไฟล์นี้เล็งไปที่ "ทางที่ผิดแล้วไม่มีเสียงอะไรกลับมา" ไม่ใช่ทางที่ผิดแล้วพัง:
//   D-scope  — `set -p history-limit` คืน rc=0 เงียบสนิท ไม่มีผล (tmux บ่นเฉพาะชื่อออปชันผิด)
//   D-order  — ตั้งหลัง new-session: show-options ตอบค่าใหม่ แต่ pane ที่เกิดแล้วยังถือค่าเก่า
//   D-shadow — ค่าที่ระดับ session ชนะ global เงียบ ๆ ⇒ pane เกิดมาด้วยเพดานที่ไม่มีใครเลือก

type RunCall = { subcommand: string; args: (string | number)[] };
type RunHandler = (subcommand: string, args: (string | number)[], callIndex: number) => string | Promise<string>;

class FakeTmux extends Tmux {
  calls: RunCall[] = [];
  handler: RunHandler;

  constructor(handler: RunHandler = () => "") {
    super(undefined, "");
    this.handler = handler;
  }

  async run(subcommand: string, ...args: (string | number)[]): Promise<string> {
    this.calls.push({ subcommand, args });
    return this.handler(subcommand, args, this.calls.length - 1);
  }

  callStrings(): string[] {
    return this.calls.map(c => [c.subcommand, ...c.args].join(" "));
  }
}

function captureWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  return fn().then(
    result => { console.warn = original; return { result, warnings }; },
    error => { console.warn = original; throw error; },
  );
}

const LIMIT = cfgLimit("tmuxHistoryLimit");

describe("tmux history-limit — กลไกตอนสร้าง pane", () => {
  test("ค่ากลางคือ 50000 และมาจาก config ไม่ใช่เลขฝังในโค้ด", () => {
    expect(LIMIT).toBe(50000);
  });

  test("D-scope: ตั้งด้วย -g เท่านั้น — ห้าม -p (เงียบ) และห้าม -t <session> (บดบัง global รอบหน้า)", async () => {
    const t = new FakeTmux();
    await t.applyHistoryLimit();

    expect(t.callStrings()).toEqual([`set-option -g history-limit ${LIMIT}`]);

    const flat = t.callStrings().join("\n");
    expect(flat).not.toContain("-p history-limit");
    expect(flat).not.toContain("set-option -t");
  });

  test("D-order: set -g ต้องมา **ก่อน** new-session ไม่ใช่หลัง", async () => {
    const t = new FakeTmux((sub, args) => {
      if (sub === "display-message") return `${LIMIT}|oracle`;
      return "";
    });
    await t.newSession("oracle", { window: "main", cwd: "/repo" });

    const order = t.callStrings();
    const iSet = order.findIndex(c => c.startsWith("set-option -g history-limit"));
    const iNew = order.findIndex(c => c.startsWith("new-session"));
    expect(iSet).toBeGreaterThanOrEqual(0);
    expect(iNew).toBeGreaterThanOrEqual(0);
    expect(iSet).toBeLessThan(iNew);
  });

  test("new-window ก็เป็น pane ใหม่ ⇒ ต้องตั้งก่อนเหมือนกัน", async () => {
    const t = new FakeTmux();
    await t.newWindow("oracle", "child");

    const order = t.callStrings();
    expect(order[0]).toBe(`set-option -g history-limit ${LIMIT}`);
    expect(order[1]).toStartWith("new-window");
  });

  test("D-shadow ทาง new-window ด้วย — เคสนี้ยิงกับ tmux จริงแล้วเกิดขึ้นจริง (1234 ชนะ 50000)", async () => {
    const t = new FakeTmux((sub, args) => {
      if (sub === "display-message") return "1234|oracle";
      return "";
    });

    const { warnings } = await captureWarnings(() => t.newWindow("oracle", "child"));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("1234");
    expect(warnings[0]).toContain("oracle:child");
    // ท่าถอนต้องชี้ที่ **session** ไม่ใช่ที่ window — ออปชันนี้ไม่มีสโคป window
    expect(warnings[0]).toContain("set-option -u -t oracle history-limit");
  });

  test("split-window ก็เป็น pane ใหม่ — ต้องตั้งก่อน และอ่านกลับที่ **pane ที่เพิ่งเกิด** ไม่ใช่ที่หน้าต่าง", async () => {
    // 📎 arc จับได้ 15.08: splitWindow() หลุดจากกลไกรอบแรก ทั้งที่คอมเมนต์ในไฟล์เดียวกัน
    // เขียนไว้เองว่า "A new window is a new pane" — split ก็เป็น pane ใหม่เหมือนกัน
    const t = new FakeTmux((sub, args) => {
      if (sub === "split-window") return "%42";
      if (sub === "display-message") return `${LIMIT}|oracle`;
      return "";
    });

    await t.splitWindow("oracle:main", { direction: "horizontal" });

    const order = t.callStrings();
    expect(order[0]).toBe(`set-option -g history-limit ${LIMIT}`);
    expect(order[1]).toStartWith("split-window");
    // อ่านกลับต้องเล็งที่ %42 (pane ที่เพิ่งเกิด) ไม่ใช่ oracle:main ซึ่งคืน pane แรกของหน้าต่าง
    expect(order[2]).toBe("display-message -p -t %42 #{history_limit}|#{session_name}");
  });

  test("split-window: ผู้เรียกที่ขอ format เองต้องได้ค่าเดิมกลับไป ไม่ถูกกลไกแย่งช่อง", async () => {
    const t = new FakeTmux((sub) => (sub === "split-window" ? "custom-output" : ""));

    const out = await t.splitWindow(undefined, { printFormat: "#{pane_pid}" });

    expect(out).toBe("custom-output");
    expect(t.callStrings().some(c => c.includes("-F #{pane_pid}"))).toBe(true);
    expect(t.callStrings().some(c => c.startsWith("display-message"))).toBe(false);
  });

  test("อ่านค่าที่ pane ได้จริงด้วย display-message — ไม่ใช่ show-options และไม่ใช่ list-panes", async () => {
    // historyLimitOf ถามค่าเดียว · ตัว warn ถามสองค่าคั่นด้วย | — fake ต้องแยกให้ออก
    const t = new FakeTmux((sub, args) => (sub === "display-message" && args.includes("#{history_limit}") ? "50000" : ""));

    expect(await t.historyLimitOf("oracle")).toBe(50000);
    expect(t.callStrings().join("\n")).not.toContain("show-options");
    // และห้ามใช้ list-panes -t <pane> — tmux คืนทุก pane ในหน้าต่าง ไม่ใช่ตัวที่ถาม
    expect(t.callStrings().join("\n")).not.toContain("list-panes");
  });

  test("D-shadow: pane เกิดมาด้วยค่าอื่น (session override ชนะ) ⇒ ต้องเตือน ไม่ใช่ผ่านเงียบ", async () => {
    const t = new FakeTmux((sub, args) => {
      // global ตั้ง 50000 สำเร็จ แต่ pane เกิดมา 200000 — อาการเป๊ะของ 15.08
      if (sub === "display-message") return "200000|oracle";
      return "";
    });

    const { warnings } = await captureWarnings(() => t.newSession("oracle"));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("200000");
    expect(warnings[0]).toContain(String(LIMIT));
    // ต้องบอกท่าถอนให้คนอ่าน ไม่ใช่บ่นเฉย ๆ
    expect(warnings[0]).toContain("set-option -u -t oracle history-limit");
  });

  test("ตรงกันแล้วต้องเงียบ — ไม่งั้นคนจะเรียนรู้ที่จะเมินคำเตือน", async () => {
    const t = new FakeTmux((sub) => (sub === "display-message" ? `${LIMIT}|oracle` : ""));

    const { warnings } = await captureWarnings(() => t.newSession("oracle"));
    expect(warnings).toEqual([]);
  });

  test("อ่านค่ากลับไม่ได้ (tmux ล่ม/pane หาย) ⇒ ห้ามเตือนมั่ว และห้ามพัง", async () => {
    const t = new FakeTmux((sub) => {
      if (sub === "display-message") throw new Error("can't find pane");
      return "";
    });

    const { warnings } = await captureWarnings(() => t.newSession("oracle"));
    expect(warnings).toEqual([]);
  });
});
