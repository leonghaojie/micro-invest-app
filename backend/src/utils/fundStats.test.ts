/**
 * fundStats (DECISIONS.md #14): hand-checkable cases for the growth path,
 * drawdown, annualisation thresholds, range handling and calendar years.
 */
import { buildFundHistory, isRangeKey, MonthlyRow, previousMonth } from "./fundStats";

/** Builds consecutive months from `start` ("2024-01") with the given fractional returns. */
function rows(start: string, returns: number[], over: Partial<MonthlyRow> = {}): MonthlyRow[] {
  let [y, m] = start.split("-").map(Number);
  return returns.map((returnPct) => {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
    return { month, endPrice: 10, dividend: 0, returnPct, ...over };
  });
}

describe("previousMonth", () => {
  it("steps back one month, across a year boundary", () => {
    expect(previousMonth("2026-03")).toBe("2026-02");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("isRangeKey", () => {
  it("accepts the five ranges and nothing else", () => {
    for (const k of ["1y", "3y", "5y", "10y", "max"]) expect(isRangeKey(k)).toBe(true);
    for (const k of ["", "2y", "MAX", "all", "constructor"]) expect(isRangeKey(k)).toBe(false);
  });
});

describe("growth of 100", () => {
  it("compounds each month's return, starting at 100 on the month before the range", () => {
    const h = buildFundHistory(rows("2024-01", [0.1, -0.1, 0.05]), "max");

    // 100 -> 110 -> 99 -> 103.95
    expect(h.series).toEqual([
      { month: "2023-12", growth: 100 },
      { month: "2024-01", growth: 110 },
      { month: "2024-02", growth: 99 },
      { month: "2024-03", growth: 103.95 },
    ]);
    expect(h.stats.totalReturnPct).toBe(3.95);
  });

  it("has one more point than months", () => {
    expect(buildFundHistory(rows("2020-01", Array(24).fill(0.01)), "max").series).toHaveLength(25);
  });
});

describe("ranges", () => {
  const data = rows("2000-01", Array(60).fill(0.01)); // 5 years of +1% months

  it("uses only the last N months for a fixed range, and rebases growth to 100 there", () => {
    const h = buildFundHistory(data, "1y");
    expect(h.months).toBe(12);
    expect(h.startMonth).toBe("2004-01");
    expect(h.endMonth).toBe("2004-12");
    expect(h.series[0].growth).toBe(100);
    expect(h.series).toHaveLength(13);
    expect(h.stats.totalReturnPct).toBeCloseTo((Math.pow(1.01, 12) - 1) * 100, 1);
  });

  it("uses everything for max", () => {
    expect(buildFundHistory(data, "max").months).toBe(60);
  });

  it("falls back to all available months when a fund is younger than the range", () => {
    const young = rows("2024-01", Array(20).fill(0.01));
    const h = buildFundHistory(young, "5y");
    expect(h.range).toBe("max"); // reports what it actually used
    expect(h.months).toBe(20);
    expect(h.startMonth).toBe("2024-01");
  });

  it("only offers ranges the fund has history for (max always)", () => {
    expect(buildFundHistory(rows("2024-01", Array(8).fill(0.01)), "max").availableRanges).toEqual(["max"]);
    expect(buildFundHistory(rows("2020-01", Array(40).fill(0.01)), "max").availableRanges).toEqual(["1y", "3y", "max"]);
    expect(buildFundHistory(data, "max").availableRanges).toEqual(["1y", "3y", "5y", "max"]);
  });
});

describe("annualised return", () => {
  it("is withheld below 12 months and defined from 12", () => {
    expect(buildFundHistory(rows("2024-01", Array(11).fill(0.01)), "max").stats.annualizedReturnPct).toBeNull();
    // 12 months of +1%: annualised equals the 12-month total
    const h = buildFundHistory(rows("2024-01", Array(12).fill(0.01)), "max");
    expect(h.stats.annualizedReturnPct).toBeCloseTo((Math.pow(1.01, 12) - 1) * 100, 1);
  });

  it("annualises a multi-year range to a per-year rate", () => {
    // 24 months, +1% each: (1.01^24)^(12/24) - 1 = 1.01^12 - 1
    const h = buildFundHistory(rows("2022-01", Array(24).fill(0.01)), "max");
    expect(h.stats.annualizedReturnPct).toBeCloseTo((Math.pow(1.01, 12) - 1) * 100, 1);
  });
});

describe("volatility", () => {
  it("is zero for constant returns and withheld below 12 months", () => {
    expect(buildFundHistory(rows("2024-01", Array(12).fill(0.02)), "max").stats.volatilityPct).toBe(0);
    expect(buildFundHistory(rows("2024-01", Array(11).fill(0.02)), "max").stats.volatilityPct).toBeNull();
  });

  it("is the sample standard deviation of monthly returns x sqrt(12), in percent", () => {
    // alternating +2% / -2%: mean 0, sample variance = 12*0.0004/11
    const alt = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 0.02 : -0.02));
    const expected = Math.sqrt((12 * 0.0004) / 11) * Math.sqrt(12) * 100;
    expect(buildFundHistory(rows("2024-01", alt), "max").stats.volatilityPct).toBeCloseTo(expected, 1);
  });
});

describe("maximum drawdown", () => {
  it("is the worst fall from a previous high", () => {
    // 100 -> 120 -> 90 -> 135 -> 108 : falls are 25% (120->90) and 20% (135->108)
    const h = buildFundHistory(rows("2024-01", [0.2, -0.25, 0.5, -0.2]), "max");
    expect(h.stats.maxDrawdownPct).toBe(-25);
  });

  it("is zero when the fund only ever rises", () => {
    expect(buildFundHistory(rows("2024-01", [0.01, 0.02, 0.03]), "max").stats.maxDrawdownPct).toBe(0);
  });

  it("counts a fall below the starting level as a drawdown", () => {
    expect(buildFundHistory(rows("2024-01", [-0.1, -0.1]), "max").stats.maxDrawdownPct).toBe(-19);
  });
});

describe("best / worst month and hit rate", () => {
  const h = buildFundHistory(rows("2024-01", [0.05, -0.08, 0.02, 0, -0.01]), "max");

  it("finds the extremes with their months, in percent", () => {
    expect(h.stats.bestMonth).toEqual({ month: "2024-01", returnPct: 5 });
    expect(h.stats.worstMonth).toEqual({ month: "2024-02", returnPct: -8 });
  });

  it("counts only strictly positive months", () => {
    expect(h.stats.positiveMonthsPct).toBe(40); // 2 of 5
  });
});

describe("calendar years", () => {
  it("compounds within each year, most recent first, flagging years with fewer than 12 months", () => {
    // Nov-Dec 2023 (partial), all of 2024 (+1%/mo), Jan-Mar 2025 (partial)
    const data = [...rows("2023-11", [0.02, 0.02]), ...rows("2024-01", Array(12).fill(0.01)), ...rows("2025-01", [0.03, 0.03, 0.03])];
    const years = buildFundHistory(data, "max").calendarYears;

    expect(years.map((y) => [y.year, y.partial])).toEqual([
      [2025, true],
      [2024, false],
      [2023, true],
    ]);
    expect(years[0].returnPct).toBeCloseTo((Math.pow(1.03, 3) - 1) * 100, 1);
    expect(years[1].returnPct).toBeCloseTo((Math.pow(1.01, 12) - 1) * 100, 1);
  });

  it("is independent of the selected range and capped at ten years", () => {
    const data = rows("2000-01", Array(15 * 12).fill(0.005));
    const h = buildFundHistory(data, "1y");
    expect(h.calendarYears).toHaveLength(10);
    expect(h.calendarYears[0].year).toBe(2014);
  });
});

describe("recent months", () => {
  it("returns the last 36 months regardless of the range, oldest first", () => {
    const data = rows("2000-01", Array.from({ length: 100 }, (_, i) => i / 1000));
    const h = buildFundHistory(data, "1y");
    expect(h.recentMonths).toHaveLength(36);
    expect(h.recentMonths[35].month).toBe(h.endMonth);
    expect(h.recentMonths[0].month < h.recentMonths[35].month).toBe(true);
  });

  it("returns what exists for a short history", () => {
    expect(buildFundHistory(rows("2024-01", [0.01, 0.02]), "max").recentMonths).toHaveLength(2);
  });
});

describe("trailing dividend yield", () => {
  it("is the last 12 months of dividends over the latest price", () => {
    // 12 months paying 0.05 each in 3 of them, price 10 => (0.15 / 10) = 1.5%
    const data = rows("2024-01", Array(12).fill(0.01)).map((r, i) => ({ ...r, dividend: i % 4 === 0 ? 0.05 : 0 }));
    expect(buildFundHistory(data, "max").trailingYieldPct).toBe(1.5);
  });

  it("only counts the most recent 12 months", () => {
    const data = [...rows("2022-01", Array(12).fill(0.01), { dividend: 1 }), ...rows("2023-01", Array(12).fill(0.01), { dividend: 0 })];
    expect(buildFundHistory(data, "max").trailingYieldPct).toBe(0);
  });

  it("is null with less than a year of data and 0 for a fund that pays nothing", () => {
    expect(buildFundHistory(rows("2024-01", Array(6).fill(0.01)), "max").trailingYieldPct).toBeNull();
    expect(buildFundHistory(rows("2024-01", Array(12).fill(0.01)), "max").trailingYieldPct).toBe(0);
  });
});

describe("edge cases", () => {
  it("throws for a fund with no data", () => {
    expect(() => buildFundHistory([], "max")).toThrow();
  });

  it("handles a single month", () => {
    const h = buildFundHistory(rows("2024-05", [0.04]), "max");
    expect(h.months).toBe(1);
    expect(h.series).toEqual([
      { month: "2024-04", growth: 100 },
      { month: "2024-05", growth: 104 },
    ]);
    expect(h.stats.annualizedReturnPct).toBeNull();
    expect(h.stats.volatilityPct).toBeNull();
  });

  it("reports the latest price", () => {
    expect(buildFundHistory(rows("2024-01", [0.01, 0.02], { endPrice: 12.34 }), "max").latestPrice).toBe(12.34);
  });
});
