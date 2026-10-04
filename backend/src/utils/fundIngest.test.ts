/**
 * fundIngest (DECISIONS.md #15): which months count as complete, how returns are
 * derived, and which rows are rejected as implausible.
 */
import { dropIncompleteMonth, deriveMonthlyReturns, findGaps, lastCompleteMonth, monthKey, monthsBetween, RawRow } from "./fundIngest";

const utc = (iso: string) => new Date(iso + "T12:00:00Z");
const row = (date: string, close: number, dividends = 0): RawRow => ({ date, close, dividends });

describe("lastCompleteMonth", () => {
  it("is the previous calendar month", () => {
    expect(lastCompleteMonth(utc("2026-10-04"))).toBe("2026-09");
    expect(lastCompleteMonth(utc("2026-10-01"))).toBe("2026-09");
    expect(lastCompleteMonth(utc("2026-10-31"))).toBe("2026-09");
  });

  it("wraps across the year boundary", () => {
    expect(lastCompleteMonth(utc("2027-01-15"))).toBe("2026-12");
  });

  it("uses UTC, not local time, at a month boundary", () => {
    expect(lastCompleteMonth(new Date("2026-10-01T00:00:00Z"))).toBe("2026-09");
    expect(lastCompleteMonth(new Date("2026-09-30T23:59:59Z"))).toBe("2026-08");
  });
});

describe("monthKey / monthsBetween", () => {
  it("formats and measures months", () => {
    expect(monthKey(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03");
    expect(monthsBetween("2026-07", "2026-09")).toBe(2);
    expect(monthsBetween("2025-11", "2026-02")).toBe(3);
    expect(monthsBetween("2026-09", "2026-09")).toBe(0);
    expect(monthsBetween("2026-09", "2026-07")).toBe(-2);
  });
});

describe("dropIncompleteMonth", () => {
  const rows = [row("2026-07-01", 10), row("2026-08-01", 11), row("2026-09-01", 12), row("2026-10-01", 13)];

  it("drops the in-progress current month", () => {
    expect(dropIncompleteMonth(rows, utc("2026-10-04")).map((r) => r.date)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  it("keeps everything when the last row is already a finished month", () => {
    expect(dropIncompleteMonth(rows.slice(0, 3), utc("2026-10-04"))).toHaveLength(3);
  });

  it("would also drop a month that lies in the future", () => {
    expect(dropIncompleteMonth([row("2026-08-01", 10), row("2026-11-01", 11)], utc("2026-10-04"))).toHaveLength(1);
  });

  it("handles no rows", () => {
    expect(dropIncompleteMonth([], utc("2026-10-04"))).toEqual([]);
  });
});

describe("deriveMonthlyReturns", () => {
  it("derives each month's total return from the previous close, with the dividend added", () => {
    const { returns } = deriveMonthlyReturns([row("2026-07-01", 100), row("2026-08-01", 110), row("2026-09-01", 99, 1)], utc("2026-10-04"));

    expect(returns.map((r) => r.month)).toEqual(["2026-08", "2026-09"]);
    expect(returns[0]).toMatchObject({ startPrice: 100, endPrice: 110, dividendAmount: 0 });
    expect(returns[0].returnPct).toBeCloseTo(0.1, 10);
    // (99 + 1 - 110) / 110
    expect(returns[1].returnPct).toBeCloseTo(-10 / 110, 10);
    expect(returns[1].monthDate.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("uses the first row only as a starting price, never as a return of its own", () => {
    expect(deriveMonthlyReturns([row("2026-07-01", 100)], utc("2026-10-04")).returns).toEqual([]);
  });

  it("does not produce a return for the unfinished current month", () => {
    const { returns } = deriveMonthlyReturns([row("2026-08-01", 100), row("2026-09-01", 101), row("2026-10-01", 105)], utc("2026-10-04"));
    expect(returns.map((r) => r.month)).toEqual(["2026-09"]);
  });

  it("rejects implausible months instead of storing them", () => {
    const { returns, rejected } = deriveMonthlyReturns(
      [row("2026-06-01", 100), row("2026-07-01", 20), row("2026-08-01", 21), row("2026-09-01", 500)],
      utc("2026-10-04")
    );
    expect(returns.map((r) => r.month)).toEqual(["2026-08"]);
    expect(rejected.map((r) => r.month)).toEqual(["2026-07", "2026-09"]);
    expect(rejected[0].reason).toMatch(/implausible/);
  });

  it("rejects non-positive and non-finite data", () => {
    const { returns, rejected } = deriveMonthlyReturns(
      [row("2026-06-01", 10), row("2026-07-01", 0), row("2026-08-01", NaN), row("2026-09-01", 10, -1)],
      utc("2026-10-04")
    );
    expect(returns).toEqual([]);
    expect(rejected).toHaveLength(3);
  });

  it("accepts a large but believable move (a crash month)", () => {
    const { returns } = deriveMonthlyReturns([row("2020-02-01", 100), row("2020-03-01", 70)], utc("2026-10-04"));
    expect(returns).toHaveLength(1);
    expect(returns[0].returnPct).toBeCloseTo(-0.3, 10);
  });
});

describe("findGaps", () => {
  it("is empty for a continuous run, including across a year end", () => {
    expect(findGaps(["2025-11", "2025-12", "2026-01", "2026-02"])).toEqual([]);
  });

  it("lists every missing month", () => {
    expect(findGaps(["2025-11", "2026-02", "2026-03"])).toEqual(["2025-12", "2026-01"]);
  });

  it("handles empty and single-element lists", () => {
    expect(findGaps([])).toEqual([]);
    expect(findGaps(["2026-01"])).toEqual([]);
  });
});
