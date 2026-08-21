import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { markInboxFrontmatterRead } from "../src/vendor/mpr-plugins/inbox/impl";

/**
 * Whole-corpus regression sweep. The shape fixtures in the sibling file are
 * transcriptions; this one runs the marker over every real letter on the host
 * and asserts the stricter delimiter search changed nothing for well-formed
 * mail — the only way to price the change against traffic instead of intuition.
 *
 * Opt-in: MAW_INBOX_CORPUS=/path/one:/path/two. Skipped when unset, so the
 * suite stays hermetic for anyone who does not have the corpus.
 */
const roots = (process.env.MAW_INBOX_CORPUS ?? "").split(":").filter(p => p && existsSync(p));
const TS_FIXED = "2026-08-21T06:00:00.000Z";

describe("markInboxFrontmatterRead — real-corpus regression", () => {
  test.skipIf(roots.length === 0)("every well-formed letter still gets marked; nothing else is touched", () => {
    let total = 0, marked = 0, refused = 0, bodyChanged = 0;
    const offenders: string[] = [];
    for (const root of roots) {
      for (const f of readdirSync(root)) {
        if (!f.endsWith(".md")) continue;
        const path = join(root, f);
        let content: string;
        try { content = readFileSync(path, "utf-8"); } catch { continue; }
        total++;
        const out = markInboxFrontmatterRead(content, TS_FIXED);
        if (out === content) { refused++; continue; }
        marked++;
        // the body — everything after the head's closing delimiter — must be identical
        const cut = (s: string) => s.slice(s.indexOf("\n---\n", 3) + 5);
        if (cut(out) !== cut(content)) { bodyChanged++; offenders.push(path); }
      }
    }
    console.log(`corpus: ${total} letters · marked ${marked} · refused ${refused} · body-changed ${bodyChanged}`);
    expect(total).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
