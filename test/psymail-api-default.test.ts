import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createPsymailApi, normalizeRoot, type PsyMailDeps } from "../src/api/psymail";

function json(res: Response): Promise<any> {
  return res.json();
}

const ROOT = "/inbox";

// In-memory fs over a mutable file map (mirrors costs-api-default.test.ts style).
// writeFileSync mutates the map so mark-read writes are assertable.
function appWithFiles(files: Record<string, string>, now = "2026-07-19T20:00:00Z") {
  const deps: PsyMailDeps = {
    resolveRoots: () => [{ oracle: "test", dir: ROOT }],
    readdirSync: ((path: string) => {
      if (path.endsWith("/dir-throws")) throw new Error("dir vanished");
      return Object.keys(files)
        .filter((f) => f.startsWith(`${path}/`))
        .map((f) => f.slice(path.length + 1));
    }) as PsyMailDeps["readdirSync"],
    readFileSync: ((path: string) => {
      if (path.endsWith("/read-throws.md")) throw new Error("read failed");
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    }) as PsyMailDeps["readFileSync"],
    writeFileSync: ((path: string, content: string) => { files[path] = content; }) as PsyMailDeps["writeFileSync"],
    statSync: ((path: string) => ({ mtimeMs: 0, isDirectory: () => false }) as any) as PsyMailDeps["statSync"],
    now: () => now,
  };
  return { app: new Elysia().use(createPsymailApi(deps)), files };
}

const richUnread = `---
from: labubu
to: echo
date: 2026-07-19 10:00 GMT+7
subject: alpha message
type: coordination
status: delivered
read: false
---
Body of alpha. Line two.`;

const richRead = `---
from: pulse
to: echo
date: 2026-07-18 09:00 GMT+7
subject: beta already read
type: signal
read: 2026-07-18T10:00:00Z
---
Beta body.`;

const noFrontmatter = `No frontmatter here at all — filename fallback path.`;

function fixture() {
  return appWithFiles({
    [`${ROOT}/2026-07-19_1000_from-labubu_alpha-msg.md`]: richUnread,
    [`${ROOT}/2026-07-18_0900_from-pulse_beta-msg.md`]: richRead,
    [`${ROOT}/2026-07-17_1612_from-morse_gamma-nofm.md`]: noFrontmatter,
  });
}

describe("psi-mail API default-suite coverage", () => {
  test("default router factory is constructible", () => {
    expect(createPsymailApi()).toBeInstanceOf(Elysia);
  });

  test("lists newest-first with parsed frontmatter, read flags, filename fallback, bounded preview", async () => {
    const { app } = fixture();
    const res = await app.handle(new Request("http://local/psi-mail"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.total).toBe(3);
    expect(body.messages[0].subject).toBe("alpha message");    // newest first
    expect(body.messages[0].read).toBe(false);                 // read: false → unread
    expect(body.messages[1].read).toBe(true);                  // read: <ISO> → read
    expect(body.messages[2].from).toBe("morse");               // filename fallback
    expect(body.messages[2].read).toBe(false);                 // no frontmatter → unread
    expect(body.messages[0].preview.length).toBeLessThanOrEqual(500);
    expect(body.messages[0].oracleHome).toBe("test");
  });

  test("unread and oracle filters + limit clamp", async () => {
    const { app } = fixture();
    let body = await json(await app.handle(new Request("http://local/psi-mail?unread=1")));
    expect(body.returned).toBe(2);                             // beta (read) excluded
    body = await json(await app.handle(new Request("http://local/psi-mail?oracle=nope")));
    expect(body.total).toBe(0);
    body = await json(await app.handle(new Request("http://local/psi-mail?limit=1")));
    expect(body.returned).toBe(1);
    expect(body.total).toBe(3);
  });

  test("body by id returns full body; unknown/traversal id → 404 (no path from client)", async () => {
    const { app } = fixture();
    const list = await json(await app.handle(new Request("http://local/psi-mail")));
    const alphaId = list.messages[0].id;
    const ok = await app.handle(new Request(`http://local/psi-mail/body?id=${encodeURIComponent(alphaId)}`));
    expect(ok.status).toBe(200);
    expect((await json(ok)).body).toContain("Body of alpha");
    const bad = await app.handle(new Request("http://local/psi-mail/body?id=test/../../etc/passwd"));
    expect(bad.status).toBe(404);
  });

  test("mark-read injects read:<ISO>, replacing read:false on disk", async () => {
    const { app, files } = fixture();
    const list = await json(await app.handle(new Request("http://local/psi-mail")));
    const alphaId = list.messages[0].id;
    const res = await app.handle(new Request("http://local/psi-mail/mark-read", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: alphaId }),
    }));
    expect(res.status).toBe(200);
    expect((await json(res)).read).toBe("2026-07-19T20:00:00Z");
    expect(files[`${ROOT}/2026-07-19_1000_from-labubu_alpha-msg.md`]).toMatch(/^read: 2026-07-19T20:00:00Z$/m);
  });

  test("mark-read is fail-closed: no editable frontmatter → 422, file NOT written", async () => {
    const { app, files } = fixture();
    const list = await json(await app.handle(new Request("http://local/psi-mail")));
    const gammaId = list.messages.find((m: any) => m.from === "morse").id;
    const before = files[`${ROOT}/2026-07-17_1612_from-morse_gamma-nofm.md`];
    const res = await app.handle(new Request("http://local/psi-mail/mark-read", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: gammaId }),
    }));
    expect(res.status).toBe(422);
    expect(files[`${ROOT}/2026-07-17_1612_from-morse_gamma-nofm.md`]).toBe(before); // unchanged
  });

  test("mark-read unknown id → 404", async () => {
    const { app } = fixture();
    const res = await app.handle(new Request("http://local/psi-mail/mark-read", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "test/nonexistent.md" }),
    }));
    expect(res.status).toBe(404);
  });

  test("a missing/throwing root is skipped, not fatal", async () => {
    const deps: PsyMailDeps = {
      resolveRoots: () => [{ oracle: "gone", dir: "/inbox/dir-throws" }, { oracle: "test", dir: ROOT }],
      readdirSync: ((path: string) => {
        if (path.endsWith("/dir-throws")) throw new Error("vanished");
        return ["2026-07-19_1000_from-labubu_alpha-msg.md"];
      }) as PsyMailDeps["readdirSync"],
      readFileSync: (() => richUnread) as PsyMailDeps["readFileSync"],
      writeFileSync: (() => {}) as PsyMailDeps["writeFileSync"],
      statSync: (() => ({ mtimeMs: 0 }) as any) as PsyMailDeps["statSync"],
      now: () => "2026-07-19T20:00:00Z",
    };
    const app = new Elysia().use(createPsymailApi(deps));
    const body = await json(await app.handle(new Request("http://local/psi-mail")));
    expect(body.total).toBe(1); // dir-throws skipped, test root read
  });

  // Config-driven roots contract (Volt-reuse spec 2026-07-19 14:13).
  test("normalizeRoot accepts string and object forms, rejects malformed / relative", () => {
    expect(normalizeRoot("volt:/root/projects/volt-oracle/ψ/inbox")).toEqual({
      oracle: "volt", dir: "/root/projects/volt-oracle/ψ/inbox",
    });
    expect(normalizeRoot({ oracle: "arc", dir: "/ghq/arc-oracle/ψ/inbox" })).toEqual({
      oracle: "arc", dir: "/ghq/arc-oracle/ψ/inbox",
    });
    expect(normalizeRoot("noPathColonButRelative:relative/dir")).toBeNull(); // dir not absolute
    expect(normalizeRoot("justastring")).toBeNull();
    expect(normalizeRoot({ oracle: "x", dir: "relative" } as any)).toBeNull();
  });
});
