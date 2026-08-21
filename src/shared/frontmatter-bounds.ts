/**
 * Where a Markdown message's frontmatter block ends — one definition, shared.
 *
 * There were three: the maw CLI's mark-read path, the psi-mail HTTP API, and
 * the CLI's own parser. Two of them located the closing delimiter with a bare
 * `content.indexOf("\n---", …)` substring search, which accepts a horizontal
 * rule in the BODY of a message whose frontmatter was never closed — so the
 * writer put `read:`/`readAt:` into the middle of the prose and promoted a real
 * body line into the head. Having one definition is the point of this file:
 * a second copy is how the bug got written twice.
 */

/**
 * True when `lines` reads as a frontmatter block rather than as prose.
 *
 * `#` and `- ` are valid in BOTH languages — a YAML comment and a YAML list
 * item, and a Markdown heading and a bullet — so no per-line shape test can
 * separate them at column 0. Rejecting them outright defends the letter but
 * refuses genuinely valid YAML; accepting them lets a message body back into
 * the frontmatter. The discriminator is context, not shape: they count as
 * frontmatter only while still inside a block that a `key:` opened and that no
 * blank line has ended. A body always arrives after a blank line.
 *
 * Known and deliberately not chased: an unclosed head whose body opens with a
 * `key:`-shaped line and NO blank line between them is still accepted. That is
 * byte-for-byte a valid frontmatter continuation, so nothing here can tell the
 * two apart — it needs the head to be closed, not a cleverer predicate.
 */
export function keyishRun(lines: string[]): boolean {
  let sawKey = false, blanked = false;
  for (const l of lines) {
    if (l === "") { blanked = true; continue; }
    // a blank line ends the block for good: without this, a body line that happens
    // to read as `Word: text` reopens it and the prose is back inside the head
    if (/^[A-Za-z_][\w-]*\s*:/.test(l)) { if (blanked) return false; sawKey = true; continue; }
    if (/^\s+\S/.test(l) && sawKey && !blanked) continue;
    if (/^(- |#)/.test(l) && sawKey && !blanked) continue;
    return false;
  }
  return sawKey;
}

export function findFrontmatterClose(content: string): number {
  const lines = content.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] !== "---") continue;
    // `key: value`, or an indented continuation of the key above it (a YAML block
    // scalar — 4 messages in the live corpus use `ref_inbox: |`). Nothing else:
    // a bullet, a heading and a blank line are all shapes that a BODY starts with,
    // and admitting them puts the body back inside the frontmatter.
    const keyish = keyishRun(lines.slice(1, i));
    if (!keyish) return -1;
    // byte offset of the "\n" that precedes this delimiter line
    return lines.slice(0, i).join("\n").length;
  }
  return -1;
}
