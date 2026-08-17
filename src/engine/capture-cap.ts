/**
 * Byte ceiling for capture payloads.
 *
 * Lives in its own module on purpose: three isolated test files replace the
 * whole of `src/engine/capture` with a partial `mock.module` stub, and bun's
 * mock.module is process-global — anything exported from there is invisible to
 * a test that happens to run after one of them. A pure helper has no reason to
 * sit behind that surface.
 */

/** Drop whole lines off the TOP until the payload fits `maxBytes`.
 *
 *  The client replaces its buffer with each `capture` message (it does not
 *  append), so the depth has to ride on every push — which makes an unbounded
 *  capture a per-tick cost at the 50ms interval. Trimming from the top keeps
 *  the newest lines, which are the ones a live viewer is watching. */
export function capByBytes(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  let lines = content.split("\n");
  while (lines.length > 1 && Buffer.byteLength(lines.join("\n"), "utf8") > maxBytes) {
    lines = lines.slice(Math.max(1, Math.ceil(lines.length * 0.1)));
  }
  return lines.join("\n");
}
