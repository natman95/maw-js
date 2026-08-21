import { describe, expect, test } from "bun:test";
import { join } from "path";
import { drainWakeInbox } from "../src/commands/shared/wake-inbox-drain";

/**
 * The third copy of "where does the frontmatter end". `markFrontmatterRead`
 * used `raw.indexOf("\n---", 4)` — the same unanchored substring search the maw
 * CLI carried until 08cc5dc2 and the psi-mail API until 05974d1c — so draining
 * an inbox with `markRead` on wrote `read:`/`readAt:` into the middle of a
 * message whose frontmatter was never closed.
 *
 * It reaches a sibling's inbox: `maw attach` spawns `maw wake` with
 * MAW_ATTACH_FOLLOWS=1 (attach/impl.ts:82,171), which is the only thing that
 * turns `markRead` on (wake-cmd.ts:1016). No cron entry and no script on this
 * host sets that variable, so the scheduled wake path never wrote — but a human
 * attaching does, into the box of whoever they attached to.
 *
 * Fixtures transcribe the delimiter structure of real correspondence; the prose
 * is substituted because the corpus is internal.
 */

const REPO = "/repo";
const INBOX = join(REPO, "ψ", "inbox");

function drainOver(files: Record<string, string>, markRead = true) {
  const written: Record<string, string> = {};
  const result = drainWakeInbox(REPO, {
    markRead,
    existsSync: ((p: string) => p === INBOX) as any,
    readdirSync: (() => Object.keys(files).map(f => f.slice(INBOX.length + 1))) as any,
    readFileSync: ((p: string) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    }) as any,
    writeFileSync: ((p: string, c: string) => { written[p] = c; files[p] = c; }) as any,
  });
  return { result, written, files };
}

const UNCLOSED = "---\nfrom: echo\nto: neo\nstatus: delivered\n";

const DESTRUCTIVE: Array<[string, string]> = [
  ["body has a bare --- rule", `${UNCLOSED}\nreal body line one\n\n---\n\ntail\n`],
  ["body has a ---- rule", `${UNCLOSED}\nFREEZE ANCHOR rc1\n\n----\n\ntail\n`],
  ["body opens with a # heading", `${UNCLOSED}\n# หัวข้อจดหมาย\n\n---\n\ntail\n`],
  ["body opens with a key:-shaped line", `${UNCLOSED}\nNote: สำคัญมาก\n\n---\n\ntail\n`],
];

describe("wake inbox drain — an unclosed frontmatter is never rewritten", () => {
  for (const [name, content] of DESTRUCTIVE) {
    test(`markRead leaves the file byte-identical: ${name}`, () => {
      const p = join(INBOX, "001.md");
      const { written, files } = drainOver({ [p]: content });
      expect(written[p]).toBeUndefined();   // nothing written at all
      expect(files[p]).toBe(content);       // byte-identical
    });
  }

  test("one bad message does not stop the good ones in the same drain", () => {
    const bad = join(INBOX, "001.md");
    const good = join(INBOX, "002.md");
    const goodContent = "---\nfrom: echo\nread: false\n---\n\nintro\n\n---\n\nsection two\n";
    const { files } = drainOver({ [bad]: DESTRUCTIVE[0][1], [good]: goodContent });
    expect(files[bad]).toBe(DESTRUCTIVE[0][1]);
    expect(files[good]).toMatch(/^read: true$/m);
  });
});

describe("wake inbox drain — well-formed messages keep working", () => {
  test("read: false with --- rules in the body is stamped, body untouched", () => {
    const p = join(INBOX, "001.md");
    const content = "---\nfrom: echo\nread: false\n---\n\nintro\n\n---\n\nsection two\n";
    const { result, files } = drainOver({ [p]: content });
    expect(result.count).toBe(1);
    expect(files[p]).toMatch(/^read: true$/m);
    expect(files[p]).toMatch(/^readAt: /m);
    expect(files[p].endsWith("\n\nintro\n\n---\n\nsection two\n")).toBe(true);
  });

  test("a column-0 list under a key survives", () => {
    const p = join(INBOX, "001.md");
    const content = "---\nfrom: echo\ntags:\n- a\n- b\nread: false\n---\n\nbody\n";
    const { files } = drainOver({ [p]: content });
    expect(files[p]).toMatch(/^read: true$/m);
    expect(files[p]).toContain("tags:\n- a\n- b");
  });

  test("already-read messages are not drained and not rewritten", () => {
    const p = join(INBOX, "001.md");
    const content = "---\nfrom: echo\nread: true\n---\n\nbody\n";
    const { result, written, files } = drainOver({ [p]: content });
    expect(result.count).toBe(0);
    expect(written[p]).toBeUndefined();
    expect(files[p]).toBe(content);
  });

  test("markRead off never writes, whatever the shape", () => {
    const p = join(INBOX, "001.md");
    const { written } = drainOver({ [p]: "---\nfrom: echo\nread: false\n---\n\nbody\n" }, false);
    expect(Object.keys(written)).toEqual([]);
  });
});
