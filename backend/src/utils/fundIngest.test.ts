/**
 * fundIngest (DECISIONS.md #15): which months count as complete, how returns are
 * derived, and which rows are rejected as implausible.
 */
import { dropIncompleteMonth, deriveMonthlyReturns, findGaps, fxRatesFromRows, lastCompleteMonth, monthKey, monthsBetween, RawRow } from "./fundIngest";

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

describe("deriveMonthlyReturns with exchange rates (DECISIONS.md #29)", () => {
  const NOW = new Date("2026-10-04T12:00:00Z");
  const rows = [
    { date: "2026-07-01", close: 100, dividends: 0 },
    { date: "2026-08-01", close: 110, dividends: 0 },
    { date: "2026-09-01", close: 110, dividends: 2 },
  ];
  const fx = fxRatesFromRows([
    { date: "2026-07-01", close: 1.4 },
    { date: "2026-08-01", close: 1.4 },
    { date: "2026-09-01", close: 1.3 },
  ]);

  it("without rates (an SGD fund) behaves as before: rate 1, own price kept", () => {
    const { returns } = deriveMonthlyReturns(rows, NOW);
    expect(returns[0]).toMatchObject({ endPrice: 110, endPriceLocal: 110, fxRate: 1, startPrice: 100 });
  });

  it("converts prices and dividends at each month's rate, with the start at the previous month's rate", () => {
    const { returns } = deriveMonthlyReturns(rows, NOW, fx);
    expect(returns[0]).toMatchObject({ month: "2026-08", startPrice: 140, endPrice: 154, endPriceLocal: 110, fxRate: 1.4 });
    expect(returns[0].returnPct).toBeCloseTo(0.1, 12); // the rate did not move: the SGD return equals the USD return
    // September: flat in USD, dividend 2, but the dollar weakened from 1.4 to 1.3
    expect(returns[1]).toMatchObject({ month: "2026-09", startPrice: 154, endPrice: 143, dividendAmount: 2.6, fxRate: 1.3 });
    expect(returns[1].returnPct).toBeCloseTo((143 + 2.6 - 154) / 154, 12);
  });

  it("a flat US price still loses in SGD when the US dollar falls, and gains when it rises", () => {
    const flat = [{ date: "2026-08-01", close: 100, dividends: 0 }, { date: "2026-09-01", close: 100, dividends: 0 }];
    const down = deriveMonthlyReturns(flat, NOW, fxRatesFromRows([{ date: "2026-08-01", close: 1.4 }, { date: "2026-09-01", close: 1.3 }])).returns[0].returnPct;
    const up = deriveMonthlyReturns(flat, NOW, fxRatesFromRows([{ date: "2026-08-01", close: 1.3 }, { date: "2026-09-01", close: 1.4 }])).returns[0].returnPct;
    expect(down).toBeCloseTo(1.3 / 1.4 - 1, 12);
    expect(up).toBeCloseTo(1.4 / 1.3 - 1, 12);
  });

  it("skips months before the rates begin without complaint (the history just starts later)", () => {
    const early = [{ date: "2003-10-01", close: 100, dividends: 0 }, { date: "2003-11-01", close: 101, dividends: 0 }, ...rows];
    const { returns, rejected } = deriveMonthlyReturns(early, NOW, fx);
    expect(returns.map((r) => r.month)).toEqual(["2026-08", "2026-09"]);
    expect(rejected).toEqual([]);
  });

  it("rejects a month with no rate after the rates begin, so the gap is reported", () => {
    const sparse = fxRatesFromRows([{ date: "2026-07-01", close: 1.4 }, { date: "2026-09-01", close: 1.3 }]); // August missing
    const { returns, rejected } = deriveMonthlyReturns(rows, NOW, sparse);
    expect(returns).toEqual([]); // August has no rate, and September's previous month has none
    expect(rejected.map((r) => r.month)).toEqual(["2026-08", "2026-09"]);
  });

  it("fxRatesFromRows ignores bad rates", () => {
    const m = fxRatesFromRows([{ date: "2026-07-01", close: 1.3 }, { date: "2026-08-01", close: 0 }, { date: "2026-09-01", close: Number.NaN }]);
    expect([...m.keys()]).toEqual(["2026-07"]);
  });
});
