import { describe, expect, test } from "bun:test";
import { markInboxFrontmatterRead } from "../src/vendor/mpr-plugins/inbox/impl";

/**
 * `maw inbox read` marks a message read by editing its frontmatter in place.
 * It locates the end of the frontmatter with `content.indexOf("\n---", 4)` —
 * a bare substring search that is not anchored to a whole line and does not
 * check that the lines above it look like `key:` pairs.
 *
 * A letter whose frontmatter block was never closed therefore hands the marker
 * the FIRST `---`-ish run in the BODY as if it were the closing delimiter. The
 * marker then writes `read:`/`readAt:` into the middle of the prose, promotes a
 * real body line into the frontmatter block, and reports success (exit 0).
 *
 * Desired behaviour: no closing delimiter => return the content UNCHANGED, so
 * `cmdInboxMarkRead` takes its existing loud path ("could not mark read",
 * exitCode 1). Never a silent, successful-looking rewrite.
 *
 * FIXTURE PROVENANCE — declared, not implied:
 *   REAL      = the delimiter structure is transcribed from a measured
 *               population of live letters (counts in each test name). Prose is
 *               substituted because those letters are internal correspondence;
 *               the delimiter structure — the only dimension under test — is
 *               preserved byte-for-byte.
 *   COMPOSED  = a real unclosed head (the 2026-07-15 15:10 batch, 2 letters,
 *               both recovered verbatim from git history) joined to a real body
 *               shape from another population. No live letter has ever been in
 *               this state; the shape is reachable and destructive, so it is
 *               tested rather than assumed away.
 *
 * The whole-corpus regression sweep over the real letters lives in
 * `inbox-frontmatter-marker-corpus.test.ts` (opt-in via MAW_INBOX_CORPUS).
 */

const TS_FIXED = "2026-08-21T06:00:00.000Z";
const mark = (s: string) => markInboxFrontmatterRead(s, TS_FIXED);

const HEAD_UNCLOSED = [
  "---",
  "from: echo",
  "to: neo",
  "date: 2026-07-15 15:10 GMT+7",
  "subject: fleet doctrine adopted",
  "type: coordination",
  "status: delivered",
].join("\n");

describe("markInboxFrontmatterRead — MUST NOT rewrite an unclosed frontmatter", () => {
  // REAL — both 2026-07-15 15:10 letters recovered from git history are this shape.
  test("REAL: unclosed head, no ----ish run anywhere in the body", () => {
    const content = `${HEAD_UNCLOSED}\n\nBoss approved fleet-wide: a guard must prove it still SEES.\n`;
    expect(mark(content)).toBe(content);
  });

  // COMPOSED — real unclosed head + the body-rule shape carried by 469 live letters.
  test("COMPOSED: unclosed head, body contains a bare --- horizontal rule", () => {
    const content = `${HEAD_UNCLOSED}\n\nreal body line one\n\n---\n\nreal body after the rule\n`;
    const out = mark(content);
    expect(out).toBe(content);
    expect(out).not.toContain("read: true");
    expect(out).toContain("real body line one\n\n---");
  });

  // COMPOSED — real unclosed head + the 4-dash shape carried by 14 live letters.
  test("COMPOSED: unclosed head, body contains a ---- rule (4 dashes)", () => {
    const content = `${HEAD_UNCLOSED}\n\nFREEZE ANCHOR rc1\n\n----\n\ntail\n`;
    expect(mark(content)).toBe(content);
  });

  // COMPOSED — `--- text` is not a delimiter, but indexOf("\n---") cannot tell.
  test("COMPOSED: unclosed head, body has a --- prefixed line with trailing text", () => {
    const content = `${HEAD_UNCLOSED}\n\nnotes below\n--- section two ---\ntail\n`;
    expect(mark(content)).toBe(content);
  });

  // COMPOSED — a fenced code block that quotes a delimiter, e.g. a letter about
  // frontmatter. This one is self-referential on purpose: the letters that
  // discuss this bug all contain fenced `---`.
  test("COMPOSED: unclosed head, --- appears inside a fenced code block", () => {
    const content = `${HEAD_UNCLOSED}\n\nthe shape is:\n\n\`\`\`\n---\nfrom: x\n---\n\`\`\`\n\ntail\n`;
    expect(mark(content)).toBe(content);
  });
});

describe("markInboxFrontmatterRead — MUST stay quiet on well-formed letters", () => {
  // REAL — 1,759 live letters carry `read: false` in a closed head.
  test("REAL: closed head with read: false flips to true and adds readAt", () => {
    const content = "---\nfrom: echo\nto: neo\nread: false\n---\n\nbody\n";
    const out = mark(content);
    expect(out).toContain("read: true");
    expect(out).toContain(`readAt: ${TS_FIXED}`);
    expect(out.endsWith("\n\nbody\n")).toBe(true);
  });

  // REAL — 1,545 live letters have a closed head with no `read:` key at all.
  test("REAL: closed head with no read: key gets one inserted", () => {
    const content = "---\nfrom: echo\nto: neo\n---\n\nbody\n";
    const out = mark(content);
    expect(out).toContain("read: true");
    expect(out).toContain(`readAt: ${TS_FIXED}`);
  });

  // REAL — 4,345 live letters already carry readAt in the head.
  test("REAL: closed head that already has readAt does not gain a second one", () => {
    const content = `---\nfrom: echo\nto: neo\nread: false\nreadAt: 2026-01-01T00:00:00.000Z\n---\n\nbody\n`;
    const out = mark(content);
    expect(out.match(/^readAt:/gm)?.length).toBe(1);
    expect(out).toContain("readAt: 2026-01-01T00:00:00.000Z");
  });

  // REAL — 469 live letters carry a bare --- horizontal rule in the body. This is
  // the near-miss Echo flagged: a naive "count the --- lines" check calls these broken.
  test("REAL: closed head + --- rules in the body — body must come through byte-identical", () => {
    const body = "\n\nintro\n\n---\n\nsection two\n\n---\n\nsection three\n";
    const content = `---\nfrom: echo\nto: neo\nread: false\n---${body}`;
    const out = mark(content);
    expect(out).toContain("read: true");
    // the body — everything from the head's closing delimiter onward — is untouched
    expect(out.endsWith(body)).toBe(true);
    expect(out.match(/^---$/gm)?.length).toBe(4); // head open, head close, 2 body rules
  });

  // REAL — 3 live letters contain a literal `read:` line inside the BODY.
  test("REAL: a read: line in the body must not be the one that gets flipped", () => {
    const content = "---\nfrom: echo\nto: neo\nread: false\n---\n\nhe wrote `read: false` in his own frontmatter\n";
    const out = mark(content);
    expect(out).toContain("he wrote `read: false` in his own frontmatter");
    expect(out.split("---\n")[1]).toContain("read: true");
  });

  // REAL — 5,231 live letters are already read; the caller short-circuits, but the
  // pure function must still not double-stamp if it is reached.
  test("REAL: closed head already read: true is not flipped again", () => {
    const content = "---\nfrom: echo\nto: neo\nread: true\nreadAt: 2026-01-01T00:00:00.000Z\n---\n\nbody\n";
    expect(mark(content)).toBe(content);
  });

  // REAL — 51 live files have no frontmatter at all (pre-convention, April 2026).
  test("REAL: a file with no frontmatter at all is returned untouched", () => {
    const content = "# just a note\n\nno frontmatter here\n";
    expect(mark(content)).toBe(content);
  });
});

/**
 * Narrowing found by a second reader (Labubu, 2026-08-21): the first cut of
 * `keyish` also admitted `# heading`, `- bullet` and blank lines — which is
 * exactly how a message BODY starts, so an unclosed head followed by prose was
 * still being rewritten. Measured on 8,595 live messages (8,544 with a closed
 * head): heads containing a bullet 0 · a heading 0 · a blank line 0 · an
 * indented continuation 4 (`ref_inbox: |`). So the narrowing costs nothing real
 * and the continuation must stay.
 */
describe("markInboxFrontmatterRead — a body shape is not a frontmatter shape", () => {
  const HEAD_UNCLOSED_2 = "---\nfrom: echo\nto: neo\nstatus: delivered\n";

  // REAL body opener — headings start the body of essentially every letter we send.
  test("REAL: unclosed head, body opens with a # heading, then a --- rule", () => {
    // no prose line between the heading and the rule: the heading must be what
    // gets rejected, not a bare word further down that happens to fail anyway
    const content = `${HEAD_UNCLOSED_2}\n# ผมผิดเรื่อง timestamp\n\n---\n\ntail\n`;
    expect(mark(content)).toBe(content);
  });

  // REAL body opener — bullet lists.
  test("REAL: unclosed head, body opens with a - bullet, then a --- rule", () => {
    const content = `${HEAD_UNCLOSED_2}\n- first point\n- second point\n\n---\n\ntail\n`;
    expect(mark(content)).toBe(content);
  });

  // REAL body opener — a blank line then an indented block (fenced/indented code).
  test("REAL: unclosed head, blank line then an indented paragraph, then a --- rule", () => {
    const content = `${HEAD_UNCLOSED_2}\n    indented block\n\n---\n\ntail\n`;
    expect(mark(content)).toBe(content);
  });

  // REAL — 4 live messages carry a YAML block scalar in the head; it must survive.
  test("REAL: closed head with a `ref_inbox: |` block scalar still gets marked", () => {
    const content = "---\nfrom: echo\nto: neo\nref_inbox: |\n  a.md\n  b.md\nread: false\n---\n\nbody\n\n---\n\ntail\n";
    const out = mark(content);
    expect(out).toContain("read: true");
    expect(out).toContain("ref_inbox: |\n  a.md\n  b.md");
    expect(out.endsWith("\n\nbody\n\n---\n\ntail\n")).toBe(true);
  });
});

/**
 * `#` and `- ` are valid YAML as well as valid Markdown, so a per-line shape
 * test cannot tell a comment from a heading or a list item from a bullet. The
 * two cases below are the ones that separate "reject the shape outright" from
 * "reject it only outside an open key block" — both must keep working.
 */
describe("markInboxFrontmatterRead — valid YAML that happens to look like prose", () => {
  test("closed head with a column-0 list under a key still gets marked", () => {
    const content = "---\nfrom: echo\ntags:\n- a\n- b\nread: false\n---\n\nbody\n\n---\n\ntail\n";
    const out = mark(content);
    expect(out).toContain("read: true");
    expect(out).toContain("tags:\n- a\n- b");
    expect(out.endsWith("\n\nbody\n\n---\n\ntail\n")).toBe(true);
  });

  test("closed head with a # comment under a key still gets marked", () => {
    const content = "---\nfrom: echo\n# a comment\nread: false\n---\n\nbody\n";
    const out = mark(content);
    expect(out).toContain("read: true");
    expect(out).toContain("# a comment");
  });
});

/**
 * A blank line ends the frontmatter block permanently. Without that, a body
 * line that happens to read as `Word: text` reopens the block and the prose is
 * back inside the head — and a message body opening that way is not exotic:
 * 147 of 8,606 live messages start their body with a `key:`-shaped line.
 *
 * The cost is the opposite shape — a blank line *between* two real keys, which
 * this now refuses. Measured on the same 8,606: 0 messages. Both counts come
 * from a sieve that passes 5 planted controls first, because a sieve that
 * cannot find a case it was handed reports a blind zero rather than a real one.
 */
describe("markInboxFrontmatterRead — a blank line closes the block for good", () => {
  test("REAL: unclosed head, blank, body opens `Note: …` (147 live messages open this way)", () => {
    const content = "---\nfrom: echo\nstatus: delivered\n\nNote: สำคัญมาก\n\n---\n\ntail\n";
    expect(mark(content)).toBe(content);
  });

  test("declared cost: a blank line between two real keys is refused (0 live messages)", () => {
    const content = "---\nfrom: echo\n\nto: neo\nread: false\n---\n\nbody\n";
    expect(mark(content)).toBe(content);
  });
});
