/**
 * Blending funds into a portfolio's history (DECISIONS.md #28): the weighted monthly-rebalanced
 * return over the months every fund has.
 */
import { MonthlyRow } from "./fundStats";
import { blendFundReturns } from "./portfolioBlend";

function rows(start: string, returns: number[]): MonthlyRow[] {
  const [y, m] = start.split("-").map(Number);
  return returns.map((r, i) => ({ month: new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7), endPrice: 100, dividend: 0, returnPct: r }));
}

describe("blendFundReturns", () => {
  it("returns a single fund's own months unchanged", () => {
    const f = rows("2020-01", [0.01, -0.02, 0.03]);
    const { rows: blended } = blendFundReturns([{ weightPct: 100, rows: f }]);
    expect(blended.map((r) => [r.month, r.returnPct])).toEqual(f.map((r) => [r.month, r.returnPct]));
  });

  it("weights each month's returns: 60% of one fund and 40% of another", () => {
    const { rows: blended } = blendFundReturns([
      { weightPct: 60, rows: rows("2020-01", [0.1, 0.0]) },
      { weightPct: 40, rows: rows("2020-01", [-0.05, 0.05]) },
    ]);
    expect(blended[0].returnPct).toBeCloseTo(0.6 * 0.1 + 0.4 * -0.05, 12); // 0.04
    expect(blended[1].returnPct).toBeCloseTo(0.02, 12);
  });

  it("compounds the blended months into a growth of 100 (the endPrice)", () => {
    const { rows: blended } = blendFundReturns([{ weightPct: 100, rows: rows("2020-01", [0.1, 0.1]) }]);
    expect(blended[0].endPrice).toBeCloseTo(110, 3);
    expect(blended[1].endPrice).toBeCloseTo(121, 3);
    expect(blended.every((r) => r.dividend === 0)).toBe(true); // dividends are inside the total returns
  });

  it("covers only the months every fund has, so the youngest fund limits the history", () => {
    const old = rows("2015-01", Array(48).fill(0.01)); // to 2018-12
    const young = rows("2017-01", Array(24).fill(0.02)); // 2017-01 to 2018-12
    const result = blendFundReturns([
      { weightPct: 50, rows: old },
      { weightPct: 50, rows: young },
    ]);
    expect(result.rows[0].month).toBe("2017-01");
    expect(result.rows).toHaveLength(24);
    expect(result.limitedBy).toBe(1);
  });

  it("stops at the month the earliest-ending fund stops", () => {
    const a = rows("2020-01", Array(12).fill(0.01)); // to 2020-12
    const b = rows("2020-01", Array(6).fill(0.01)); // to 2020-06
    expect(blendFundReturns([{ weightPct: 50, rows: a }, { weightPct: 50, rows: b }]).rows).toHaveLength(6);
  });

  it("is empty when the funds share no month, when a fund has no data, or with no funds", () => {
    expect(blendFundReturns([{ weightPct: 50, rows: rows("2010-01", [0.01]) }, { weightPct: 50, rows: rows("2020-01", [0.01]) }]).rows).toEqual([]);
    expect(blendFundReturns([{ weightPct: 50, rows: [] }, { weightPct: 50, rows: rows("2020-01", [0.01]) }]).rows).toEqual([]);
    expect(blendFundReturns([])).toEqual({ rows: [], limitedBy: -1 });
  });

  it("treats the weights as proportions, so 30/20 behaves like 60/40", () => {
    const a = rows("2020-01", [0.1]);
    const b = rows("2020-01", [0]);
    const x = blendFundReturns([{ weightPct: 60, rows: a }, { weightPct: 40, rows: b }]).rows[0].returnPct;
    const y = blendFundReturns([{ weightPct: 30, rows: a }, { weightPct: 20, rows: b }]).rows[0].returnPct;
    expect(y).toBeCloseTo(x, 12);
  });
});
