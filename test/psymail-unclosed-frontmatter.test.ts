import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createPsymailApi, type PsyMailDeps } from "../src/api/psymail";

/**
 * `injectRead` located the end of the frontmatter with
 * `content.indexOf("\n---", 3)` — the same unanchored substring search the maw
 * CLI carried until 08cc5dc2. For a message whose frontmatter was opened but
 * never closed, the first `---`-ish run in the BODY is taken as the closing
 * delimiter, so `read:`/`readAt:` are written into the middle of the prose and
 * a real body line is promoted into the frontmatter block.
 *
 * Two things make this worse than the CLI twin it mirrors: it is reachable over
 * HTTP on the running server (`api/index.ts` mounts psymailApi), and
 * `/psi-mail/mark-read-all` walks the whole box, so one call can damage every
 * affected message at once.
 *
 * The route already has the right contract for this — "no editable frontmatter
 * → 422, file NOT written". These cases only ask that an unclosed head count as
 * "no editable frontmatter", which it always was.
 *
 * Fixtures are transcriptions of the delimiter structure of real correspondence;
 * the prose is substituted because the corpus is internal. The measured live
 * populations behind each shape are named per test.
 */

const ROOT = "/inbox";

function appWithFiles(files: Record<string, string>, now = "2026-08-21T07:00:00Z") {
  const deps: PsyMailDeps = {
    resolveRoots: () => [{ oracle: "test", dir: ROOT }],
    readdirSync: ((path: string) =>
      Object.keys(files).filter(f => f.startsWith(`${path}/`)).map(f => f.slice(path.length + 1))
    ) as PsyMailDeps["readdirSync"],
    readFileSync: ((path: string) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    }) as PsyMailDeps["readFileSync"],
    writeFileSync: ((path: string, content: string) => { files[path] = content; }) as PsyMailDeps["writeFileSync"],
    statSync: (() => ({ mtimeMs: 0, isDirectory: () => false }) as any) as PsyMailDeps["statSync"],
    now: () => now,
  };
  return { app: new Elysia().use(createPsymailApi(deps)), files };
}

const UNCLOSED_HEAD = "---\nfrom: echo\nto: neo\nstatus: delivered\n";

const SHAPES: Array<[string, string]> = [
  // 469 live messages carry a bare `---` rule in the body.
  ["body has a bare --- rule", `${UNCLOSED_HEAD}\nreal body line one\n\n---\n\ntail\n`],
  // 14 live messages carry a `----` setext underline in the body.
  ["body has a ---- rule", `${UNCLOSED_HEAD}\nFREEZE ANCHOR rc1\n\n----\n\ntail\n`],
  // every letter we send opens its body with a heading.
  ["body opens with a # heading", `${UNCLOSED_HEAD}\n# หัวข้อจดหมาย\n\n---\n\ntail\n`],
  // …or a bullet list.
  ["body opens with a - bullet", `${UNCLOSED_HEAD}\n- first point\n\n---\n\ntail\n`],
  // 147 live messages open their body with a `key:`-shaped line.
  ["body opens with a key:-shaped line", `${UNCLOSED_HEAD}\nNote: สำคัญมาก\n\n---\n\ntail\n`],
];

async function markRead(app: Elysia, id: string) {
  return app.handle(new Request("http://local/psi-mail/mark-read", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
  }));
}

describe("psymail mark-read — an unclosed frontmatter is not editable frontmatter", () => {
  for (const [name, content] of SHAPES) {
    test(`POST /psi-mail/mark-read refuses and does not write: ${name}`, async () => {
      const path = `${ROOT}/2026-08-21_0700_from-echo_unclosed.md`;
      const { app, files } = appWithFiles({ [path]: content });
      const list = await (await app.handle(new Request("http://local/psi-mail"))).json();
      const res = await markRead(app, list.messages[0].id);
      expect(res.status).toBe(422);
      expect(files[path]).toBe(content);           // byte-identical
      expect(files[path]).not.toMatch(/^read: true$/m);
    });
  }

  test("POST /psi-mail/mark-read-all leaves every affected message byte-identical and counts them as skipped", async () => {
    const files: Record<string, string> = {};
    SHAPES.forEach(([, content], i) => { files[`${ROOT}/2026-08-21_070${i}_from-echo_unclosed.md`] = content; });
    const good = `${ROOT}/2026-08-21_0709_from-echo_good.md`;
    files[good] = "---\nfrom: echo\nto: neo\nread: false\n---\n\nintro\n\n---\n\nsection two\n";
    const before = { ...files };
    const { app } = appWithFiles(files);
    const res = await app.handle(new Request("http://local/psi-mail/mark-read-all", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(SHAPES.length);
    expect(body.marked).toBe(1);
    for (const [, content] of SHAPES.entries()) void content;
    SHAPES.forEach((_, i) => {
      const p = `${ROOT}/2026-08-21_070${i}_from-echo_unclosed.md`;
      expect(files[p]).toBe(before[p]);
    });
    expect(files[good]).toMatch(/^read: true$/m);
  });
});

describe("psymail mark-read — well-formed messages must keep working", () => {
  const QUIET: Array<[string, string]> = [
    ["body contains --- rules (469 live)", "---\nfrom: echo\nread: false\n---\n\nintro\n\n---\n\nsection two\n"],
    ["column-0 list under a key", "---\nfrom: echo\ntags:\n- a\n- b\nread: false\n---\n\nbody\n\n---\n\ntail\n"],
    ["# comment under a key", "---\nfrom: echo\n# a comment\nread: false\n---\n\nbody\n"],
    ["block scalar under a key (4 live)", "---\nfrom: echo\nref_inbox: |\n  a.md\n  b.md\nread: false\n---\n\nbody\n"],
    ["no read: key at all (1,545 live)", "---\nfrom: echo\nto: neo\n---\n\nbody\n"],
  ];
  for (const [name, content] of QUIET) {
    test(`POST /psi-mail/mark-read still stamps: ${name}`, async () => {
      const path = `${ROOT}/2026-08-21_0800_from-echo_good.md`;
      const { app, files } = appWithFiles({ [path]: content });
      const list = await (await app.handle(new Request("http://local/psi-mail"))).json();
      const res = await markRead(app, list.messages[0].id);
      expect(res.status).toBe(200);
      expect(files[path]).toMatch(/^read: true$/m);
      expect(files[path]).toMatch(/^readAt: 2026-08-21T07:00:00Z$/m);
      // the body — everything after the head's closing delimiter — is untouched
      const bodyOf = (s: string) => s.slice(s.indexOf("\n---\n", 3));
      expect(bodyOf(files[path])).toBe(bodyOf(content));
    });
  }
});
