import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findFrontmatterClose } from "../src/shared/frontmatter-bounds";
import { loadInboxMessages } from "../src/vendor/mpr-plugins/inbox/impl";
import { createPsymailApi, type PsyMailDeps } from "../src/api/psymail";

/**
 * The READ side of "where does the frontmatter end". The write side was unified
 * onto `findFrontmatterClose` in 08cc5dc2 / 05974d1c / c658a9a2; the readers were
 * not. `impl.ts` and `psymail.ts` each carried their own
 * `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/` — non-greedy, so it stops at the FIRST
 * `---` line it meets. In a message whose head was never closed that line belongs
 * to the BODY, so the prose above it is promoted into the frontmatter and the
 * body is served truncated.
 *
 * What this file asserts is NOT "each reader still works" — it is that all
 * readers agree with the one shared definition, which is the property the
 * unification buys. `wake-inbox-drain.ts:42` already calls it directly.
 *
 * Fixtures transcribe the delimiter structure of real correspondence (the same
 * shapes as wake-inbox-drain-unclosed-frontmatter.test.ts); prose is substituted
 * because the corpus is internal.
 */

const UNCLOSED = "---\nfrom: echo\nto: neo\nstatus: delivered\n";
const SENTINEL = "real body line one";

const UNCLOSED_FIXTURES: Array<[string, string]> = [
  ["body has a bare --- rule", `${UNCLOSED}\n${SENTINEL}\n\n---\n\ntail\n`],
  ["body has a ---- rule", `${UNCLOSED}\n${SENTINEL}\n\n----\n\ntail\n`],
  ["body opens with a # heading", `${UNCLOSED}\n# ${SENTINEL}\n\n---\n\ntail\n`],
  ["body opens with a - bullet", `${UNCLOSED}\n- ${SENTINEL}\n\n---\n\ntail\n`],
];

const CLOSED = `---\nfrom: echo\nto: neo\ndate: 2026-08-21 10:00 GMT+7\nsubject: closed head\n---\n\n${SENTINEL}\n\n---\n\ntail\n`;

function inboxWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "fm-read-boundary-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function psymailOver(dir: string, files: Record<string, string>) {
  const deps: PsyMailDeps = {
    resolveRoots: () => [{ oracle: "neo", dir }],
    readdirSync: (() => Object.keys(files)) as any,
    readFileSync: ((p: string) => files[p.slice(dir.length + 1)]) as any,
    writeFileSync: (() => {}) as any,
    statSync: (() => ({ mtimeMs: 1_700_000_000_000 })) as any,
    now: () => "2026-08-21T10:00:00.000Z",
  };
  return new Elysia().use(createPsymailApi(deps));
}

async function psymailList(dir: string, files: Record<string, string>): Promise<any[]> {
  const app = psymailOver(dir, files);
  const list: any = await (await app.handle(new Request("http://local/psi-mail"))).json();
  return list.messages;
}

async function psymailBodies(dir: string, files: Record<string, string>): Promise<string[]> {
  const app = psymailOver(dir, files);
  const list: any = await (await app.handle(new Request("http://local/psi-mail"))).json();
  const out: string[] = [];
  for (const m of list.messages) {
    const one: any = await (await app.handle(new Request(`http://local/psi-mail/body?id=${encodeURIComponent(m.id)}`))).json();
    out.push(one.body ?? "");
  }
  return out;
}

describe("frontmatter read boundary — every reader agrees with the shared definition", () => {
  for (const [label, content] of UNCLOSED_FIXTURES) {
    test(`unclosed head, ${label}: the shared definition refuses to close it`, () => {
      // the reference the other two must match
      expect(findFrontmatterClose(content)).toBe(-1);
    });

    test(`unclosed head, ${label}: impl.ts serves the whole body, not a truncation`, () => {
      const name = "2026-08-21_1000_from-echo_fixture.md";
      const dir = inboxWith({ [name]: content });
      try {
        const [msg] = loadInboxMessages(dir);
        expect(msg).toBeDefined();
        expect(msg.body).toContain(SENTINEL);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test(`unclosed head, ${label}: psymail serves the whole body, not a truncation`, async () => {
      const name = "2026-08-21_1000_from-echo_fixture.md";
      const dir = inboxWith({});
      try {
        const bodies = await psymailBodies(dir, { [name]: content });
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).toContain(SENTINEL);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  /**
   * The closed-head case is the ONLY one that can tell a working boundary from a
   * broken one. Every unclosed fixture above expects "no closing delimiter", which
   * is also what a boundary function stuck at -1 returns — so those cases are green
   * in both states and carry no information about the boundary itself (they do
   * carry it about the READER, which is why they stay). 📎 Labubu found this by
   * forcing findFrontmatterClose to -1 in psymail.ts and watching the suite stay
   * green; the assertions below are the ones that go red when she does it again.
   */
  test("control — a closed head is STRIPPED from the body, not merely present in it", async () => {
    const name = "2026-08-21_1000_from-echo_closed.md";
    const dir = inboxWith({ [name]: CLOSED });
    const HEAD_LINE = "subject: closed head";
    try {
      const [msg] = loadInboxMessages(dir);
      expect(msg.frontmatter.from).toBe("echo");
      expect(msg.body).toContain(SENTINEL);
      expect(msg.body).toContain("tail");
      // the discriminating half: a reader stuck at -1 hands back the whole file,
      // so the head would still be sitting inside body
      expect(msg.body).not.toContain(HEAD_LINE);

      const bodies = await psymailBodies(dir, { [name]: CLOSED });
      expect(bodies[0]).toContain(SENTINEL);
      expect(bodies[0]).toContain("tail");
      expect(bodies[0]).not.toContain(HEAD_LINE);

      // and the head must actually have been PARSED, not just removed: the filename
      // fallback would answer "closed" here, so only a real frontmatter read gives
      // the full subject
      const [item] = await psymailList(dir, { [name]: CLOSED });
      expect(item.subject).toBe("closed head");
      expect(item.date).toBe("2026-08-21 10:00 GMT+7");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
