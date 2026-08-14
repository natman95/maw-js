import { describe, expect, test } from "bun:test";
import { inboxRedReasons } from "../src/vendor/mpr-plugins/inbox/impl";

/**
 * Silence set for the inbox red/green badge.
 *
 * Reported by Volt (srv1809016) 2026-08-14 00:20 — his box printed
 *   🔴 UNREAD 0 (oldest none, last archive 28d ago, Δ 0 last cycle) → not draining
 * on an inbox that was completely drained. He said out loud that he had not read the code,
 * so his own diagnosis was UNVERIFIED; it turned out to be `since_archive>8h` firing with
 * no unread mail to justify it.
 *
 * The must-stay-quiet half carries the higher bar on purpose: a badge that is red on a
 * green state does not get fixed, it gets ignored, and then the day mail really is stuck
 * nobody looks. Every fixture below is a state this fleet actually produces — Volt's
 * reading, a freshly-awakened Oracle with no archive dir, a normal working box.
 */
describe("inboxRedReasons — archive staleness only counts when there is mail to drain", () => {
  const EMPTY = { unread: 0, oldestAgeSeconds: null, delta: 0, archiveAdvanced: false };

  describe("must stay quiet", () => {
    test("Volt's case: 0 unread, archive 28 days old", () => {
      expect(inboxRedReasons({ ...EMPTY, lastArchiveAgeSeconds: 28 * 24 * 3600 })).toEqual([]);
    });

    test("0 unread and no archive directory at all (a just-awakened Oracle)", () => {
      expect(inboxRedReasons({ ...EMPTY, lastArchiveAgeSeconds: null })).toEqual([]);
    });

    test("0 unread, archive fresh", () => {
      expect(inboxRedReasons({ ...EMPTY, lastArchiveAgeSeconds: 60 })).toEqual([]);
    });

    test("mail present, young, archive fresh — an ordinary working box", () => {
      expect(inboxRedReasons({
        unread: 3, oldestAgeSeconds: 600, lastArchiveAgeSeconds: 3600,
        delta: 0, archiveAdvanced: false,
      })).toEqual([]);
    });

    test("unread DROPPED since last check with no new archive — draining, not stalling", () => {
      expect(inboxRedReasons({
        unread: 2, oldestAgeSeconds: 300, lastArchiveAgeSeconds: 3600,
        delta: -5, archiveAdvanced: false,
      })).toEqual([]);
    });

    test("exactly at each threshold, not over it", () => {
      expect(inboxRedReasons({
        unread: 50, oldestAgeSeconds: 4 * 3600, lastArchiveAgeSeconds: 8 * 3600,
        delta: 0, archiveAdvanced: false,
      })).toEqual([]);
    });
  });

  describe("must fire — the pile-up the badge exists for is still caught", () => {
    test("mail waiting AND the archive has gone stale", () => {
      expect(inboxRedReasons({
        unread: 4, oldestAgeSeconds: 600, lastArchiveAgeSeconds: 28 * 24 * 3600,
        delta: 0, archiveAdvanced: false,
      })).toEqual(["since_archive>8h"]);
    });

    test("mail waiting and no archive has ever been written", () => {
      expect(inboxRedReasons({
        unread: 1, oldestAgeSeconds: 60, lastArchiveAgeSeconds: null,
        delta: 0, archiveAdvanced: false,
      })).toEqual(["no_archive"]);
    });

    test("the oldest letter has been sitting more than four hours", () => {
      expect(inboxRedReasons({
        unread: 1, oldestAgeSeconds: 5 * 3600, lastArchiveAgeSeconds: 60,
        delta: 0, archiveAdvanced: false,
      })).toEqual(["oldest>4h"]);
    });

    test("more than fifty unread", () => {
      expect(inboxRedReasons({
        unread: 51, oldestAgeSeconds: 60, lastArchiveAgeSeconds: 60,
        delta: 0, archiveAdvanced: false,
      })).toEqual(["unread>50"]);
    });

    test("the pile grew and nothing was filed", () => {
      expect(inboxRedReasons({
        unread: 5, oldestAgeSeconds: 60, lastArchiveAgeSeconds: 60,
        delta: 3, archiveAdvanced: false,
      })).toEqual(["delta>0_no_archive_activity"]);
    });

    test("the pile grew but filing happened too — quiet", () => {
      expect(inboxRedReasons({
        unread: 5, oldestAgeSeconds: 60, lastArchiveAgeSeconds: 60,
        delta: 3, archiveAdvanced: true,
      })).toEqual([]);
    });

    test("several reasons at once are all reported, not just the first", () => {
      expect(inboxRedReasons({
        unread: 60, oldestAgeSeconds: 9 * 3600, lastArchiveAgeSeconds: 9 * 3600,
        delta: 2, archiveAdvanced: false,
      })).toEqual(["unread>50", "oldest>4h", "since_archive>8h", "delta>0_no_archive_activity"]);
    });
  });
});
