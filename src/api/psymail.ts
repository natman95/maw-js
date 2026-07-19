import { Elysia, t } from "elysia";
import { readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { loadConfig } from "../config";

// ψ-Mail — read the inter-Oracle mail (ψ/inbox/*.md) that the family uses to
// coordinate (labubu-send, completion-report, coordination). Distinct from
// /api/messages (the maw send/api-send ledger) and /api/asks (the Ask center):
// those never see files dropped by labubu-send. Feature F1 of the 2026-07-19
// MAW deep-analysis. GET endpoints are read-only; the single POST only injects a
// `read:` stamp. All are gated by the nginx auth_request in front of /maw/api/.
//
// SECURITY: the client NEVER supplies a filesystem path. The inbox roots are a
// fixed allowlist below; a message `id` is only ever COMPARED against ids we
// build from our own scan — never used to construct a path. So a crafted id
// (../, absolute, symlink) can at worst fail to match. (Dispatch requirement:
// "ห้ามรับ path จาก client — กัน traversal".)

/** Fixed allowlist: the 5 sibling Oracle inbox roots. oracle = display home. */
export interface InboxRoot {
  oracle: string;
  dir: string;
}

const DEFAULT_ROOTS: InboxRoot[] = [
  { oracle: "labubu", dir: "/root/projects/labubu-oracle/ψ/inbox" },
  { oracle: "neo", dir: "/root/projects/neo-oracle/ψ/inbox" },
  { oracle: "echo", dir: "/root/projects/echo-oracle/ψ/inbox" },
  { oracle: "pulse", dir: "/root/projects/pulse-oracle/ψ/inbox" },
  { oracle: "nari", dir: "/root/projects/tconhr/ψ/inbox" },
];

// Normalize one config entry ("oracle:/abs/dir" or {oracle,dir}) → InboxRoot.
// Returns null for a malformed entry (dropped, not fatal). Only absolute dirs
// are accepted — the roots are a trust boundary, never a client-supplied path.
export function normalizeRoot(entry: string | { oracle: string; dir: string }): InboxRoot | null {
  if (typeof entry === "string") {
    const i = entry.indexOf(":");
    if (i <= 0) return null;
    const oracle = entry.slice(0, i).trim();
    const dir = entry.slice(i + 1).trim();
    if (!oracle || !dir.startsWith("/")) return null;
    return { oracle, dir };
  }
  if (entry && typeof entry.oracle === "string" && typeof entry.dir === "string" && entry.dir.startsWith("/")) {
    return { oracle: entry.oracle.trim(), dir: entry.dir.trim() };
  }
  return null;
}

// Config-driven roots (spec add 2026-07-19 14:13 — so Volt's box can reuse this
// same fork patch with its own inbox layout). Reads `psiMailRoots` from
// maw.config.json; falls back to the 5 white-box defaults when absent/empty/
// unparseable. Never throws.
function resolveRootsFromConfig(): InboxRoot[] {
  try {
    const raw = (loadConfig() as { psiMailRoots?: unknown }).psiMailRoots;
    if (Array.isArray(raw) && raw.length) {
      const parsed = raw
        .map((e) => normalizeRoot(e as string | { oracle: string; dir: string }))
        .filter((r): r is InboxRoot => r !== null);
      if (parsed.length) return parsed;
    }
  } catch {
    // config unreadable → fall through to defaults
  }
  return DEFAULT_ROOTS;
}

export interface PsyMailItem {
  id: string;
  file: string;
  oracleHome: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  type: string;
  read: boolean;
  preview: string;
}

interface ParsedMail extends PsyMailItem {
  path: string;
  sortKey: number;
  body: string;
}

// ── Frontmatter parse (hand-rolled — matches the codebase convention of not
// pulling gray-matter/js-yaml; see src/vendor/mpr-plugins/inbox/impl.ts). ──
function splitFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm, body: content.trim() };
  for (const line of m[1].split("\n")) {
    const c = line.indexOf(":");
    if (c < 0) continue;
    const k = line.slice(0, c).trim().toLowerCase();
    const v = line.slice(c + 1).trim();
    if (k && !(k in fm)) fm[k] = v;
  }
  return { fm, body: m[2].trim() };
}

// A message is UNREAD iff it has no `read` value or it is empty / "false" /
// "no". Any other value (an ISO stamp, "true") counts as read — tolerates both
// the boolean and the `read: <ISO>` conventions.
function isRead(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s !== "" && s !== "false" && s !== "no";
}

// Filename fallback for messages authored without full frontmatter, e.g.
//   2026-07-19_1339_from-labubu_tier1-maw-dashboard-build.md
//   2026-07-17_16-12_srv1809016-morse_srv1809016-morse-echo.md
function fromFilename(file: string): { date: string; from: string; subject: string } {
  const stem = file.replace(/\.md$/, "");
  const dateM = stem.match(/^(\d{4}-\d{2}-\d{2})(?:[_-](\d{2})[-_]?(\d{2}))?/);
  const date = dateM ? dateM[1] : "";
  const fromM = stem.match(/from-([a-z0-9]+)/i);
  const from = fromM ? fromM[1] : "";
  // subject = trailing slug after the last "from-…_" or the whole tail
  let subject = stem;
  const tailM = stem.match(/(?:from-[a-z0-9]+|_)([a-z0-9-]+)$/i);
  if (tailM) subject = tailM[1].replace(/-/g, " ");
  return { date, from, subject };
}

function parseDateSort(date: string, file: string, mtimeMs: number): number {
  const t = Date.parse(date);
  if (!isNaN(t)) return t;
  // fall back to the yyyy-mm-dd_hhmm in the filename, else file mtime
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})[_-](\d{2})[-_]?(\d{2})/);
  if (m) {
    const d = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
    if (!isNaN(d)) return d;
  }
  const dm = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dm) {
    const d = Date.parse(`${dm[1]}-${dm[2]}-${dm[3]}T00:00:00`);
    if (!isNaN(d)) return d;
  }
  return mtimeMs;
}

export interface PsyMailDeps {
  /** Resolve the allowlisted inbox roots (config-driven; fallback to defaults). */
  resolveRoots: () => InboxRoot[];
  readdirSync: typeof readdirSync;
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  statSync: typeof statSync;
  now: () => string;
}

export function createPsymailApi(deps: PsyMailDeps = {
  resolveRoots: resolveRootsFromConfig,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  now: () => new Date().toISOString(),
}) {
  /** Scan the allowlisted roots → parsed mail, newest first. Never throws. */
  function scanAll(): ParsedMail[] {
    const out: ParsedMail[] = [];
    for (const root of deps.resolveRoots()) {
      let files: string[];
      try {
        files = deps.readdirSync(root.dir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
      } catch {
        continue; // missing root = skip, not fatal
      }
      for (const file of files) {
        const path = join(root.dir, file);
        let content = "";
        let mtimeMs = 0;
        try {
          content = String(deps.readFileSync(path, "utf-8"));
          mtimeMs = deps.statSync(path).mtimeMs;
        } catch {
          continue; // unreadable = skip
        }
        const { fm, body } = splitFrontmatter(content);
        const fb = fromFilename(file);
        const date = fm.date || fm.timestamp || fb.date || "";
        const item: ParsedMail = {
          id: `${root.oracle}/${file}`,
          file,
          oracleHome: root.oracle,
          from: fm.from || fb.from || "unknown",
          to: fm.to || root.oracle,
          date,
          subject: fm.subject || fb.subject || file.replace(/\.md$/, ""),
          type: fm.type || "message",
          read: isRead(fm.read),
          preview: body.replace(/\s+/g, " ").slice(0, 500),
          path,
          sortKey: parseDateSort(date, file, mtimeMs),
          body,
        };
        out.push(item);
      }
    }
    out.sort((a, b) => b.sortKey - a.sortKey);
    return out;
  }

  /** Resolve an id to its scanned entry — id is only matched, never a path. */
  function findById(id: string): ParsedMail | undefined {
    return scanAll().find((m) => m.id === id);
  }

  function toItem(m: ParsedMail): PsyMailItem {
    const { path, sortKey, body, ...item } = m;
    return item;
  }

  // Inject/replace `read: <ISO>` in the frontmatter. Fail-closed discipline
  // (per commit 8742bebc's markInboxFrontmatterRead — confirmed against source
  // 2026-07-19; that util is CLI-scoped to one inbox with a read:true+readAt
  // shape, so the *discipline* is reused here, not the function): if there is no
  // valid frontmatter to edit, return the content UNCHANGED so the caller can
  // detect the no-op and refuse to write (never silently succeed).
  function injectRead(content: string, iso: string): string {
    if (!content.startsWith("---\n")) return content;
    const end = content.indexOf("\n---", 3);
    if (end < 0) return content;
    let header = content.slice(0, end);
    const footer = content.slice(end);
    if (/^read:.*$/m.test(header)) {
      header = header.replace(/^read:.*$/m, `read: ${iso}`);
    } else {
      header = `${header}\nread: ${iso}`;
    }
    return header + footer;
  }

  const api = new Elysia();

  // List — newest first. Optional filters: oracle (home inbox), unread-only.
  api.get(
    "/psi-mail",
    ({ query }) => {
      let mail = scanAll();
      if (query.oracle) mail = mail.filter((m) => m.oracleHome === query.oracle);
      if (query.unread === "1" || query.unread === "true") mail = mail.filter((m) => !m.read);
      const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));
      const items = mail.slice(0, limit).map(toItem);
      return { messages: items, total: mail.length, returned: items.length };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        oracle: t.Optional(t.String()),
        unread: t.Optional(t.String()),
      }),
    },
  );

  // Full body of one message (id resolved server-side via re-scan).
  api.get(
    "/psi-mail/body",
    ({ query, set }) => {
      const m = findById(query.id);
      if (!m) {
        set.status = 404;
        return { error: "not found" };
      }
      return { ...toItem(m), body: m.body };
    },
    { query: t.Object({ id: t.String() }) },
  );

  // Mark one message read (inject `read: <ISO>`). Fail-closed on a no-op write.
  api.post(
    "/psi-mail/mark-read",
    ({ body, set }) => {
      const m = findById(body.id);
      if (!m) {
        set.status = 404;
        return { error: "not found" };
      }
      let content = "";
      try {
        content = String(deps.readFileSync(m.path, "utf-8"));
      } catch {
        set.status = 500;
        return { error: "unreadable" };
      }
      const iso = deps.now();
      const updated = injectRead(content, iso);
      if (updated === content) {
        // no valid frontmatter to stamp → fail-closed, do not write
        set.status = 422;
        return { error: "could not mark read (no editable frontmatter)", id: m.id };
      }
      try {
        deps.writeFileSync(m.path, updated);
      } catch {
        set.status = 500;
        return { error: "write failed", id: m.id };
      }
      return { ok: true, id: m.id, read: iso };
    },
    { body: t.Object({ id: t.String() }) },
  );

  return api;
}

export const psymailApi = createPsymailApi();
