import { describe, test, expect } from "bun:test";
import { todayDate, todayLabel, timePeriod } from "../src/pulse";

describe("todayDate", () => {
  test("returns YYYY-MM-DD format", () => {
    const date = todayDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("matches current date", () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(todayDate()).toBe(expected);
  });
});

describe("todayLabel", () => {
  test("contains date and Thai day name in parens", () => {
    const label = todayLabel();
    expect(label).toMatch(/^\d{4}-\d{2}-\d{2} \(.+\)$/);
  });

  test("contains todayDate", () => {
    expect(todayLabel()).toContain(todayDate());
  });
});

describe("timePeriod", () => {
  test("returns a valid period", () => {
    const period = timePeriod();
    expect(["morning", "afternoon", "evening", "midnight"]).toContain(period);
  });
});
