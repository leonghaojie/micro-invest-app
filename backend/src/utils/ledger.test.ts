/**
 * The ledger engine (DECISIONS.md #19): months, money helpers and the replay that turns
 * credits, buys and sells into holdings, cash and monthly snapshots.
 */
import { addMonths, averageMonthlyBuy, contributionConsistency, creditFor, LedgerEntry, monthRange, monthsBetween, replay, spareIncome, splitByWeights, tradeMonthAfter } from "./ledger";

const buy = (month: string, fundId: string, amount: number): LedgerEntry => ({ month, side: "BUY", fundId, amount });
const sell = (month: string, fundId: string, amount: number): LedgerEntry => ({ month, side: "SELL", fundId, amount });

describe("months", () => {
  it("adds and counts months across year ends", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2025-12", "2026-03")).toBe(3);
    expect(monthsBetween("2026-03", "2025-12")).toBe(-3);
  });

  it("the trade month is the month after the latest data", () => {
    expect(tradeMonthAfter("2026-09")).toBe("2026-10");
    expect(tradeMonthAfter("2026-12")).toBe("2027-01");
  });

  it("monthRange is inclusive", () => {
    expect(monthRange("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthRange("2026-05", "2026-05")).toEqual(["2026-05"]);
    expect(monthRange("2026-06", "2026-05")).toEqual([]);
  });
});

describe("spareIncome", () => {
  it("is income minus expense, negative when the month spends more than it earns (DECISIONS.md #31)", () => {
    expect(spareIncome(4000, 2400)).toBe(1600);
    expect(spareIncome(2000, 2500)).toBe(-500);
    expect(spareIncome(3000.5, 1000.25)).toBe(2000.25);
  });
});

describe("creditFor (DECISIONS.md #31)", () => {
  it("credits a surplus whole", () => {
    expect(creditFor(1600, 0)).toBe(1600);
    expect(creditFor(0, 500)).toBe(0);
  });

  it("pays a deficit from the cash the account has", () => {
    expect(creditFor(-500, 2000)).toBe(-500);
    expect(creditFor(-500, 500)).toBe(-500);
  });

  it("never takes more than the cash: the account does not go into debt", () => {
    expect(creditFor(-500, 120.5)).toBe(-120.5);
    expect(creditFor(-500, 0)).toBe(0);
    expect(creditFor(-500, -30)).toBe(0);
  });
});

describe("splitByWeights", () => {
  const w = (...p: number[]) => p.map((weightPct, i) => ({ fundId: `f${i}`, weightPct }));
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount * 100, 0));

  it("always adds up to exactly the amount", () => {
    for (const amount of [100, 100.01, 33.33, 0.07, 999.99, 1234.56]) {
      for (const weights of [w(50, 50), w(33.33, 33.33, 33.34), w(40, 30, 20, 10), w(100), w(60, 25, 15)]) {
        expect(sum(splitByWeights(amount, weights))).toBe(Math.round(amount * 100));
      }
    }
  });

  it("splits by weight", () => {
    expect(splitByWeights(100, w(60, 40))).toEqual([
      { fundId: "f0", amount: 60 },
      { fundId: "f1", amount: 40 },
    ]);
  });

  it("gives leftover cents to the heaviest fund first, deterministically", () => {
    // $0.10 over 33/33/34: 3 cents each, 1 left; the heaviest (f2) takes it
    expect(splitByWeights(0.1, w(33, 33, 34))).toEqual([
      { fundId: "f0", amount: 0.03 },
      { fundId: "f1", amount: 0.03 },
      { fundId: "f2", amount: 0.04 },
    ]);
    expect(splitByWeights(0.1, w(34, 33, 33))).toEqual(splitByWeights(0.1, w(34, 33, 33)));
  });

  it("drops legs that would get nothing and handles empty or zero weights", () => {
    expect(splitByWeights(0.01, w(70, 30))).toEqual([{ fundId: "f0", amount: 0.01 }]);
    expect(splitByWeights(100, [])).toEqual([]);
    expect(splitByWeights(100, w(0, 0))).toEqual([]);
  });
});

describe("replay", () => {
  const returns = {
    A: { "2026-01": 0.1, "2026-02": -0.05, "2026-03": 0.02 },
    B: { "2026-01": 0, "2026-02": 0.2, "2026-03": 0 },
  };

  it("a negative credit (a month that spent more than it earned) lowers cash, DECISIONS.md #31", () => {
    const r = replay({
      credits: [
        { month: "2026-01", amount: 1000 },
        { month: "2026-02", amount: -300 },
        { month: "2026-03", amount: 500 },
      ],
      entries: [],
      returns,
      latestDataMonth: "2026-03",
    });
    expect(r.cash).toBe(1200);
  });

  it("is empty with no facts", () => {
    expect(replay({ credits: [], entries: [], returns, latestDataMonth: "2026-03" })).toEqual({
      points: [],
      holdings: [],
      cash: 0,
      netInvested: 0,
      firstBuyMonth: null,
    });
  });

  it("matches a hand calculation for one fund: flows first, then the month's return", () => {
    const r = replay({
      credits: [
        { month: "2026-01", amount: 1000 },
        { month: "2026-02", amount: 1000 },
      ],
      entries: [buy("2026-01", "A", 500)],
      returns,
      latestDataMonth: "2026-02",
    });
    // Jan: 500 x 1.10 = 550. Feb: 550 x 0.95 = 522.5
    expect(r.points.map((p) => p.endingValue)).toEqual([550, 522.5]);
    expect(r.points[0].portfolioReturn).toBeCloseTo(0.1, 12);
    expect(r.points[1].portfolioReturn).toBeCloseTo(-0.05, 12);
    expect(r.points.map((p) => p.cash)).toEqual([500, 1500]);
    expect(r.points.map((p) => p.totalInvested)).toEqual([500, 500]);
    expect(r.points.map((p) => p.netFlow)).toEqual([500, 0]);
    expect(r.holdings).toEqual([{ fundId: "A", value: 522.5, costBasis: 500 }]);
    expect(r.cash).toBe(1500);
    expect(r.firstBuyMonth).toBe("2026-01");
  });

  it("a month's money added at its start earns that month's return", () => {
    const r = replay({
      credits: [{ month: "2026-01", amount: 1000 }],
      entries: [buy("2026-01", "A", 100), buy("2026-02", "A", 100)],
      returns,
      latestDataMonth: "2026-02",
    });
    // Jan 100 x 1.1 = 110; Feb (110 + 100) x 0.95 = 199.5
    expect(r.points.map((p) => p.endingValue)).toEqual([110, 199.5]);
    // The time-weighted return is the fund's own return, however much was added
    expect(r.points[1].portfolioReturn).toBeCloseTo(-0.05, 12);
  });

  it("tracks several funds, drifting with the market (no rebalancing)", () => {
    const r = replay({
      credits: [{ month: "2026-01", amount: 1000 }],
      entries: [buy("2026-01", "A", 100), buy("2026-01", "B", 100)],
      returns,
      latestDataMonth: "2026-03",
    });
    const byFund = Object.fromEntries(r.holdings.map((h) => [h.fundId, h.value]));
    // A: 100 -> 110 -> 104.5 -> 106.59; B: 100 -> 100 -> 120 -> 120
    expect(byFund.A).toBeCloseTo(106.59, 2);
    expect(byFund.B).toBeCloseTo(120, 2);
    // the portfolio return is value-weighted, not equal-weighted
    expect(r.points[1].portfolioReturn).toBeCloseTo((104.5 + 120) / (110 + 100) - 1, 10);
  });

  it("sells reduce cost in proportion (average cost) and move money to cash", () => {
    const r = replay({
      credits: [{ month: "2026-01", amount: 500 }],
      entries: [buy("2026-01", "A", 100), buy("2026-02", "A", 100), sell("2026-02", "A", 55)],
      returns: { A: { "2026-01": 0.1, "2026-02": 0 } },
      latestDataMonth: "2026-02",
    });
    // After Jan: value 110, cost 100. Feb: buy 100 -> 210/200; sell 55 of 210 -> cost 200 x (155/210)
    const h = r.holdings[0];
    expect(h.value).toBeCloseTo(155, 2);
    expect(h.costBasis).toBeCloseTo(200 * (155 / 210), 2);
    expect(r.cash).toBe(500 - 100 - 100 + 55);
    expect(r.netInvested).toBe(100 + 100 - 55);
    expect(r.points[1].netFlow).toBe(45);
  });

  it("selling everything empties the holding and leaves a month with no position", () => {
    const r = replay({
      credits: [{ month: "2026-01", amount: 500 }],
      entries: [buy("2026-01", "A", 100), sell("2026-02", "A", 110)],
      returns: { A: { "2026-01": 0.1, "2026-02": 0.5, "2026-03": 0.5 } },
      latestDataMonth: "2026-03",
    });
    expect(r.holdings).toEqual([]);
    expect(r.points[2].hasPosition).toBe(false);
    expect(r.points[2].portfolioReturn).toBe(0);
    expect(r.points[2].endingValue).toBe(0);
    expect(r.cash).toBe(500 - 100 + 110);
  });

  it("marks months before the first buy as having no position", () => {
    const r = replay({
      credits: [
        { month: "2026-01", amount: 300 },
        { month: "2026-02", amount: 300 },
      ],
      entries: [buy("2026-02", "A", 100)],
      returns,
      latestDataMonth: "2026-02",
    });
    expect(r.points.map((p) => p.hasPosition)).toEqual([false, true]);
    expect(r.firstBuyMonth).toBe("2026-02");
  });

  it("holds the trade month's trades at cost, with no snapshot until its data exists", () => {
    const r = replay({
      credits: [
        { month: "2026-02", amount: 500 },
        { month: "2026-03", amount: 500 },
      ],
      entries: [buy("2026-03", "A", 200)],
      returns,
      latestDataMonth: "2026-02",
    });
    expect(r.points.map((p) => p.month)).toEqual(["2026-02"]);
    expect(r.holdings).toEqual([{ fundId: "A", value: 200, costBasis: 200 }]);
    expect(r.cash).toBe(500 + 500 - 200);
    expect(r.netInvested).toBe(200);
  });

  it("once the month's data arrives, the same trade earns that month's return", () => {
    const entries = [buy("2026-03", "A", 200)];
    const credits = [{ month: "2026-03", amount: 500 }];
    const before = replay({ credits, entries, returns, latestDataMonth: "2026-02" });
    const after = replay({ credits, entries, returns, latestDataMonth: "2026-03" });
    expect(before.holdings[0].value).toBe(200);
    expect(after.holdings[0].value).toBeCloseTo(204, 2); // A's March return is +2%
  });

  it("refuses a sell larger than what is held", () => {
    expect(() =>
      replay({ credits: [{ month: "2026-01", amount: 500 }], entries: [buy("2026-01", "A", 100), sell("2026-01", "A", 100.5)], returns, latestDataMonth: "2026-01" })
    ).toThrow(/sells more/);
  });

  it("applies a month's buys before its sells, so a sell can use what was bought that month", () => {
    const r = replay({
      credits: [{ month: "2026-01", amount: 500 }],
      entries: [sell("2026-01", "A", 50), buy("2026-01", "A", 100)],
      returns,
      latestDataMonth: "2026-01",
    });
    expect(r.holdings[0].value).toBeCloseTo(55, 2); // (100 - 50) x 1.10
    expect(r.cash).toBe(450);
  });

  it("needs a return for every held fund and month, but not for funds never held", () => {
    expect(() =>
      replay({ credits: [{ month: "2026-01", amount: 500 }], entries: [buy("2026-01", "A", 100)], returns: { A: {} }, latestDataMonth: "2026-01" })
    ).toThrow(/no return/);
    expect(() =>
      replay({ credits: [{ month: "2026-01", amount: 500 }], entries: [buy("2026-01", "A", 100)], returns: { A: { "2026-01": 0.1 }, Z: {} }, latestDataMonth: "2026-01" })
    ).not.toThrow();
  });

  it("keeps cash in whole cents (no floating-point drift)", () => {
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 30; i++) entries.push(buy("2026-01", "A", 0.1));
    const r = replay({ credits: [{ month: "2026-01", amount: 10 }], entries, returns: { A: { "2026-01": 0 } }, latestDataMonth: "2026-01" });
    expect(r.cash).toBe(7);
    expect(r.netInvested).toBe(3);
  });

  it("is deterministic: the same facts give the same result", () => {
    const input = {
      credits: [{ month: "2026-01", amount: 1000 }],
      entries: [buy("2026-01", "A", 100), buy("2026-02", "B", 50)],
      returns,
      latestDataMonth: "2026-03",
    };
    expect(replay(input)).toEqual(replay(input));
  });
});

describe("averageMonthlyBuy", () => {
  it("is zero with no buys", () => {
    expect(averageMonthlyBuy([], "2026-10")).toBe(0);
    expect(averageMonthlyBuy([sell("2026-09", "A", 10)], "2026-10")).toBe(0);
  });

  it("averages over the months since the first buy, including the trade month", () => {
    const entries = [buy("2026-08", "A", 100), buy("2026-09", "A", 100), buy("2026-09", "B", 50)];
    // Aug, Sep, Oct: (100 + 150 + 0) / 3
    expect(averageMonthlyBuy(entries, "2026-10")).toBeCloseTo(83.33, 2);
  });

  it("uses at most the last 12 months", () => {
    const entries = [buy("2025-01", "A", 1000), buy("2026-10", "A", 120)];
    // window is 2025-11..2026-10 (12 months); the 2025-01 buy is outside it
    expect(averageMonthlyBuy(entries, "2026-10")).toBe(10);
  });

  it("counts only buys, not sells", () => {
    expect(averageMonthlyBuy([buy("2026-10", "A", 100), sell("2026-10", "A", 40)], "2026-10")).toBe(100);
  });
});

describe("contributionConsistency", () => {
  const months = (from: string, n: number) => monthRange(from, addMonths(from, n - 1));

  it("is null with no buys", () => {
    expect(contributionConsistency([], "2026-10")).toBeNull();
  });

  it("is 100% when every month since the first buy has one", () => {
    expect(contributionConsistency(months("2026-05", 6), "2026-10")).toEqual({ monthsWithBuy: 6, monthsCounted: 6, pct: 100 });
  });

  it("counts a month without a buy against, e.g. a skipped monthly buy", () => {
    // Jun, Jul, (Aug missed), Sep, Oct
    const r = contributionConsistency(["2026-06", "2026-07", "2026-09", "2026-10"], "2026-10")!;
    expect(r).toEqual({ monthsWithBuy: 4, monthsCounted: 5, pct: 80 });
  });

  it("does not count months before the first buy", () => {
    expect(contributionConsistency(["2026-08", "2026-09", "2026-10"], "2026-10")!.monthsCounted).toBe(3);
  });

  it("an open trade month with no buy yet is not a miss", () => {
    // bought Jul, Aug, Sep; October has just begun
    expect(contributionConsistency(["2026-07", "2026-08", "2026-09"], "2026-10")).toEqual({ monthsWithBuy: 3, monthsCounted: 3, pct: 100 });
  });

  it("but a trade month with a buy counts", () => {
    expect(contributionConsistency(["2026-08", "2026-09", "2026-10"], "2026-10")).toEqual({ monthsWithBuy: 3, monthsCounted: 3, pct: 100 });
  });

  it("looks back at most 12 months", () => {
    // first buy in 2024, then only the last two months: the old gap is outside the window
    const r = contributionConsistency(["2024-01", "2026-09", "2026-10"], "2026-10")!;
    expect(r.monthsCounted).toBe(12);
    expect(r.monthsWithBuy).toBe(2);
    expect(r.pct).toBe(16.7);
  });

  it("is null with fewer than 3 months to judge", () => {
    expect(contributionConsistency(["2026-09", "2026-10"], "2026-10")).toBeNull();
    expect(contributionConsistency(["2026-10"], "2026-10")).toBeNull();
  });

  it("ignores duplicates (several buys in a month are one month with a buy)", () => {
    expect(contributionConsistency(["2026-08", "2026-08", "2026-09", "2026-10"], "2026-10")!.monthsWithBuy).toBe(3);
  });
});
