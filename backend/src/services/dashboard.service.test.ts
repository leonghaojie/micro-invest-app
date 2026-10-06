/**
 * DashboardService unit tests — FR08, reshaped for the ledger (DECISIONS.md #19). The plan
 * service is mocked: the dashboard only reshapes the account it returns.
 */
import { prisma } from "../config/prisma";
import { planService } from "./plan.service";
import { buildDashboardPlan, dashboardService } from "./dashboard.service";

jest.mock("./plan.service", () => ({
  planService: { getActivePlan: jest.fn() },
  round2: (v: number) => Math.round(v * 100) / 100,
}));
jest.mock("../config/prisma", () => ({ prisma: { fund: { findMany: jest.fn() } } }));

const mockedPlanService = planService as unknown as { getActivePlan: jest.Mock };
const mockedPrisma = prisma as unknown as { fund: { findMany: jest.Mock } };

const FUNDS = [
  { id: "f-a35", ticker: "A35.SI", name: "ABF Bond", assetClass: "BOND", currency: "SGD" },
  { id: "f-es3", ticker: "ES3.SI", name: "SPDR STI", assetClass: "EQUITY", currency: "SGD" },
];

const PLAN_SUMMARY = {
  planId: "plan-1",
  tradeMonth: "2026-10",
  latestDataMonth: "2026-09",
  contributionAmount: 100,
  startMonth: "2026-01-01",
  finalValue: 620.5,
  totalContributed: 600,
  growth: 20.5,
  walletBalance: 300,
  months: [
    { monthDate: "2026-01-01", portfolioReturnPct: 0.01, contribution: 100, endingBalance: 101, totalInvested: 100, walletBalance: 50, hasPosition: true },
    { monthDate: "2026-02-01", portfolioReturnPct: 0.02, contribution: 100, endingBalance: 205.02, totalInvested: 200, walletBalance: 100, hasPosition: true },
  ],
  holdings: [
    { fundId: "f-a35", value: 248.2, costBasis: 240 },
    { fundId: "f-es3", value: 372.3, costBasis: 360 },
  ],
};

describe("DashboardService", () => {
  describe("getSummary", () => {
    it("reports no account for a user without a profile", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(null);
      expect(await dashboardService.getSummary("user-1")).toEqual({ hasPlan: false, hasHoldings: false, latestPlan: null });
    });

    it("builds the summary from the account and the funds it holds", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(PLAN_SUMMARY);
      mockedPrisma.fund.findMany.mockResolvedValue(FUNDS);

      const result = await dashboardService.getSummary("user-1");

      expect(result.hasPlan).toBe(true);
      expect(result.hasHoldings).toBe(true);
      expect(result.latestPlan).toMatchObject({ planId: "plan-1", tradeMonth: "2026-10", finalValue: 620.5, totalContributed: 600, walletBalance: 300, totalAssets: 920.5 });
      expect(mockedPrisma.fund.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["f-a35", "f-es3"] } } }));
    });

    it("still shows the account (and its cash) before anything is bought", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue({ ...PLAN_SUMMARY, finalValue: 0, totalContributed: 0, growth: 0, months: [], holdings: [], walletBalance: 1600 });
      const result = await dashboardService.getSummary("user-1");
      expect(result.hasPlan).toBe(true);
      expect(result.hasHoldings).toBe(false);
      expect(result.latestPlan).toMatchObject({ walletBalance: 1600, totalAssets: 1600, holdings: [], lastMonth: null });
      expect(mockedPrisma.fund.findMany).not.toHaveBeenCalled();
    });
  });

  describe("getGrowth", () => {
    it("has no points without an account", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(null);
      expect(await dashboardService.getGrowth("user-1")).toEqual({ planId: null, points: [] });
    });

    it("maps the months to chart points", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(PLAN_SUMMARY);
      expect((await dashboardService.getGrowth("user-1")).points).toEqual([
        { monthDate: "2026-01-01", portfolioValue: 101, invested: 100, walletBalance: 50 },
        { monthDate: "2026-02-01", portfolioValue: 205.02, invested: 200, walletBalance: 100 },
      ]);
    });

    it("carries the money put in beside each month's value, so the gap between them is the profit or loss", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(PLAN_SUMMARY);
      const points = (await dashboardService.getGrowth("user-1")).points;
      expect(points.map((p) => Math.round((p.portfolioValue - p.invested) * 100) / 100)).toEqual([1, 5.02]);
    });

    it("starts the chart when money first went in, not at account opening", async () => {
      const idle = { monthDate: "2025-12-01", portfolioReturnPct: 0, contribution: 0, endingBalance: 0, totalInvested: 0, walletBalance: 300, hasPosition: false };
      mockedPlanService.getActivePlan.mockResolvedValue({ ...PLAN_SUMMARY, months: [idle, ...PLAN_SUMMARY.months] });
      const points = (await dashboardService.getGrowth("user-1")).points;
      expect(points.map((p) => p.monthDate)).toEqual(["2026-01-01", "2026-02-01"]);
    });
  });
});

describe("buildDashboardPlan", () => {
  const plan = (over: object = {}) => ({ ...PLAN_SUMMARY, ...over });

  it("total assets are the invested value plus cash", () => {
    expect(buildDashboardPlan(plan({ finalValue: 1000.25, walletBalance: 250.5 }), FUNDS).totalAssets).toBe(1250.75);
  });

  it("total profit is value minus net invested, with its percentage of what was put in", () => {
    const p = buildDashboardPlan(plan({ finalValue: 660, totalContributed: 600, growth: 60 }), FUNDS);
    expect(p.growth).toBe(60);
    expect(p.growthPct).toBe(10);
  });

  it("has no percentage when nothing is invested", () => {
    expect(buildDashboardPlan(plan({ totalContributed: 0, growth: 0, finalValue: 0, months: [], holdings: [] }), FUNDS).growthPct).toBeNull();
  });

  it("counts only months with money invested", () => {
    const idle = { monthDate: "2025-12-01", portfolioReturnPct: 0, contribution: 0, endingBalance: 0, totalInvested: 0, walletBalance: 300, hasPosition: false };
    expect(buildDashboardPlan(plan({ months: [idle, ...PLAN_SUMMARY.months] }), FUNDS).monthsRunning).toBe(2);
  });

  describe("last month's P&L (after that month's own buys and sells)", () => {
    it("is the latest month's change minus the net money put in that month", () => {
      // Jan ends 101; Feb adds 100, ends 205.02 -> profit 205.02 - 101 - 100 = 4.02 on a base of 201
      expect(buildDashboardPlan(plan(), FUNDS).lastMonth).toEqual({ month: "2026-02", pnl: 4.02, pnlPct: 2 });
    });

    it("works for the very first month (nothing before it)", () => {
      expect(buildDashboardPlan(plan({ months: [PLAN_SUMMARY.months[0]] }), FUNDS).lastMonth).toEqual({ month: "2026-01", pnl: 1, pnlPct: 1 });
    });

    it("can be a loss", () => {
      const down = plan({
        months: [
          { monthDate: "2026-01-01", portfolioReturnPct: 0, contribution: 100, endingBalance: 100, totalInvested: 100, walletBalance: 0, hasPosition: true },
          { monthDate: "2026-02-01", portfolioReturnPct: -0.1, contribution: 100, endingBalance: 180, totalInvested: 200, walletBalance: 0, hasPosition: true },
        ],
      });
      expect(buildDashboardPlan(down, FUNDS).lastMonth).toEqual({ month: "2026-02", pnl: -20, pnlPct: -10 });
    });

    it("treats a month with a sale as money taken out, not as a loss", () => {
      const sold = plan({
        months: [
          { monthDate: "2026-01-01", portfolioReturnPct: 0, contribution: 100, endingBalance: 100, totalInvested: 100, walletBalance: 0, hasPosition: true },
          { monthDate: "2026-02-01", portfolioReturnPct: 0.1, contribution: -50, endingBalance: 55, totalInvested: 50, walletBalance: 50, hasPosition: true },
        ],
      });
      // (100 - 50) x 1.1 = 55: profit 55 - 100 + 50 = 5 on a base of 50
      expect(buildDashboardPlan(sold, FUNDS).lastMonth).toEqual({ month: "2026-02", pnl: 5, pnlPct: 10 });
    });

    it("is null when nothing has been invested yet", () => {
      expect(buildDashboardPlan(plan({ months: [] }), FUNDS).lastMonth).toBeNull();
      const idle = { monthDate: "2026-02-01", portfolioReturnPct: 0, contribution: 0, endingBalance: 0, totalInvested: 0, walletBalance: 300, hasPosition: false };
      expect(buildDashboardPlan(plan({ months: [idle] }), FUNDS).lastMonth).toBeNull();
    });
  });

  describe("holdings", () => {
    it("lists each held fund with its value and share, largest first", () => {
      const p = buildDashboardPlan(plan(), FUNDS);
      expect(p.holdings.map((h) => [h.ticker, h.value])).toEqual([
        ["ES3.SI", 372.3],
        ["A35.SI", 248.2],
      ]);
      expect(p.holdings[0]).toMatchObject({ fundId: "f-es3", name: "SPDR STI", assetClass: "EQUITY", currency: "SGD", weightPct: 60 });
    });

    it("shows each holding's own profit against its cost", () => {
      const [es3, a35] = buildDashboardPlan(plan(), FUNDS).holdings;
      expect(es3).toMatchObject({ costBasis: 360, profit: 12.3, profitPct: 3.42 });
      expect(a35).toMatchObject({ costBasis: 240, profit: 8.2, profitPct: 3.42 });
    });

    it("shares add up to 100 (within rounding)", () => {
      const sum = buildDashboardPlan(plan(), FUNDS).holdings.reduce((s, h) => s + h.weightPct, 0);
      expect(Math.abs(sum - 100)).toBeLessThan(0.02);
    });

    it("breaks equal values by ticker so the order is stable", () => {
      const p = buildDashboardPlan(
        plan({ holdings: [{ fundId: "z", value: 100, costBasis: 100 }, { fundId: "a", value: 100, costBasis: 100 }] }),
        [{ id: "z", ticker: "ZZZ", name: "Z", assetClass: "EQUITY", currency: "USD" }, { id: "a", ticker: "AAA", name: "A", assetClass: "BOND", currency: "USD" }]
      );
      expect(p.holdings.map((h) => h.ticker)).toEqual(["AAA", "ZZZ"]);
    });

    it("has no profit percentage for a holding with no cost, and skips a fund that can no longer be found", () => {
      const p = buildDashboardPlan(plan({ holdings: [{ fundId: "f-a35", value: 5, costBasis: 0 }, { fundId: "gone", value: 10, costBasis: 10 }] }), FUNDS);
      expect(p.holdings).toHaveLength(1);
      expect(p.holdings[0].profitPct).toBeNull();
    });

    it("is empty with nothing held", () => {
      expect(buildDashboardPlan(plan({ holdings: [] }), FUNDS).holdings).toEqual([]);
    });
  });
});
