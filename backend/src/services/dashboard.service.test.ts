/**
 * DashboardService unit tests — FR08, rewritten for DECISIONS.md #1 third
 * amendment (25 Aug 2026): reads off plan.service.ts's one active plan
 * instead of a Simulation history; getBehaviour/ConsistencyScore is gone
 * (see dashboard.service.ts header). planService itself is mocked here —
 * dashboard.service.ts only reshapes its output, doesn't compute anything
 * new — with plan.service.test.ts owning the engine's own coverage.
 */
import { prisma } from "../config/prisma";
import { planService } from "./plan.service";
import { buildDashboardPlan, dashboardService } from "./dashboard.service";

jest.mock("./plan.service", () => ({
  planService: { getActivePlan: jest.fn() },
  round2: (v: number) => Math.round(v * 100) / 100,
}));
jest.mock("../config/prisma", () => ({ prisma: { portfolio: { findUnique: jest.fn() } } }));

const mockedPlanService = planService as unknown as { getActivePlan: jest.Mock };
const mockedPrisma = prisma as unknown as { portfolio: { findUnique: jest.Mock } };

const PORTFOLIO = {
  isPreset: true,
  allocations: [
    { fundId: "f-a35", weightPct: "40.00", fund: { ticker: "A35.SI", name: "ABF Bond", assetClass: "BOND", currency: "SGD" } },
    { fundId: "f-es3", weightPct: "60.00", fund: { ticker: "ES3.SI", name: "SPDR STI", assetClass: "EQUITY", currency: "SGD" } },
  ],
};

const PLAN_SUMMARY = {
  planId: "plan-1",
  portfolioId: "pf-1",
  portfolioName: "Growth",
  contributionAmount: 100,
  startMonth: "2026-01-01",
  finalValue: 620.5,
  totalContributed: 600,
  growth: 20.5,
  walletBalance: 300,
  months: [
    { monthDate: "2026-01-01", portfolioReturnPct: 0.01, contribution: 100, endingBalance: 101, totalInvested: 100, walletBalance: 50 },
    { monthDate: "2026-02-01", portfolioReturnPct: 0.02, contribution: 100, endingBalance: 205.02, totalInvested: 200, walletBalance: 100 },
  ],
};

describe("DashboardService", () => {
  describe("getSummary", () => {
    it("reports no plan for a brand-new user", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(null);

      const result = await dashboardService.getSummary("user-1");

      expect(result).toEqual({ hasPlan: false, latestPlan: null });
    });

    it("builds the summary from the active plan and its portfolio's funds", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(PLAN_SUMMARY);
      mockedPrisma.portfolio.findUnique.mockResolvedValue(PORTFOLIO);

      const result = await dashboardService.getSummary("user-1");

      expect(mockedPrisma.portfolio.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pf-1" } }));
      expect(result.hasPlan).toBe(true);
      expect(result.latestPlan).toMatchObject({
        planId: "plan-1",
        portfolioName: "Growth",
        portfolioIsPreset: true,
        startMonth: "2026-01-01",
        contributionAmount: 100,
        monthsRunning: 2,
        finalValue: 620.5,
        totalContributed: 600,
        growth: 20.5,
        walletBalance: 300,
        totalAssets: 920.5,
      });
    });
  });

  describe("getGrowth", () => {
    it("returns an empty series for a brand-new user", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(null);

      const result = await dashboardService.getGrowth("user-1");

      expect(result).toEqual({ planId: null, portfolioName: null, points: [] });
    });

    it("maps the active plan's months to a points series", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(PLAN_SUMMARY);

      const result = await dashboardService.getGrowth("user-1");

      expect(result).toEqual({
        planId: "plan-1",
        portfolioName: "Growth",
        points: [
          { monthDate: "2026-01-01", portfolioValue: 101, walletBalance: 50 },
          { monthDate: "2026-02-01", portfolioValue: 205.02, walletBalance: 100 },
        ],
      });
    });
  });
});

describe("buildDashboardPlan", () => {
  const plan = (over: object = {}) => ({ ...PLAN_SUMMARY, ...over });

  it("total assets are the invested value plus cash", () => {
    expect(buildDashboardPlan(plan({ finalValue: 1000.25, walletBalance: 250.5 }), PORTFOLIO).totalAssets).toBe(1250.75);
  });

  it("unrealised P&L is value minus contributed, with its percentage of what was put in", () => {
    const p = buildDashboardPlan(plan({ finalValue: 660, totalContributed: 600, growth: 60 }), PORTFOLIO);
    expect(p.growth).toBe(60);
    expect(p.growthPct).toBe(10);
  });

  it("has no percentage when nothing has been contributed yet", () => {
    expect(buildDashboardPlan(plan({ totalContributed: 0, growth: 0, finalValue: 0, months: [] }), PORTFOLIO).growthPct).toBeNull();
  });

  describe("last month's P&L (after that month's own contribution)", () => {
    it("is the latest month's change minus the contribution made that month", () => {
      // Jan ends 101; Feb adds 100, ends 205.02 -> profit 205.02 - 101 - 100 = 4.02 on a base of 201
      expect(buildDashboardPlan(plan(), PORTFOLIO).lastMonth).toEqual({ month: "2026-02", pnl: 4.02, pnlPct: 2 });
    });

    it("works for the very first month (nothing before it)", () => {
      const first = plan({ months: [PLAN_SUMMARY.months[0]] });
      // starts at 0, adds 100, ends 101 -> profit 1 on a base of 100
      expect(buildDashboardPlan(first, PORTFOLIO).lastMonth).toEqual({ month: "2026-01", pnl: 1, pnlPct: 1 });
    });

    it("can be a loss", () => {
      const down = plan({
        months: [
          { monthDate: "2026-01-01", portfolioReturnPct: 0, contribution: 100, endingBalance: 100, totalInvested: 100, walletBalance: 0 },
          { monthDate: "2026-02-01", portfolioReturnPct: -0.1, contribution: 100, endingBalance: 180, totalInvested: 200, walletBalance: 0 },
        ],
      });
      expect(buildDashboardPlan(down, PORTFOLIO).lastMonth).toEqual({ month: "2026-02", pnl: -20, pnlPct: -10 });
    });

    it("is null when the plan has no months yet (it starts in the future)", () => {
      expect(buildDashboardPlan(plan({ months: [] }), PORTFOLIO).lastMonth).toBeNull();
    });
  });

  describe("holdings", () => {
    it("values each fund at its weight of the portfolio, largest first", () => {
      const p = buildDashboardPlan(plan({ finalValue: 1000 }), PORTFOLIO);
      expect(p.holdings.map((h) => [h.ticker, h.weightPct, h.value])).toEqual([
        ["ES3.SI", 60, 600],
        ["A35.SI", 40, 400],
      ]);
      expect(p.holdings[0]).toMatchObject({ fundId: "f-es3", name: "SPDR STI", assetClass: "EQUITY", currency: "SGD" });
    });

    it("breaks equal weights by ticker so the order is stable", () => {
      const equal = {
        isPreset: false,
        allocations: [
          { fundId: "z", weightPct: "50.00", fund: { ticker: "ZZZ", name: "Z", assetClass: "EQUITY", currency: "USD" } },
          { fundId: "a", weightPct: "50.00", fund: { ticker: "AAA", name: "A", assetClass: "BOND", currency: "USD" } },
        ],
      };
      expect(buildDashboardPlan(plan(), equal).holdings.map((h) => h.ticker)).toEqual(["AAA", "ZZZ"]);
    });

    it("carries no per-fund profit (the plan rebalances monthly, so a per-fund cost would be invented)", () => {
      const json = JSON.stringify(buildDashboardPlan(plan(), PORTFOLIO).holdings);
      expect(json).not.toMatch(/pnl|profit|growth|cost/i);
    });

    it("values add up to the portfolio value (within rounding)", () => {
      const p = buildDashboardPlan(plan({ finalValue: 12345.67 }), PORTFOLIO);
      expect(Math.abs(p.holdings.reduce((sum, h) => sum + h.value, 0) - 12345.67)).toBeLessThan(0.02);
    });

    it("is empty if the portfolio can no longer be found, rather than failing", () => {
      const p = buildDashboardPlan(plan(), null);
      expect(p.holdings).toEqual([]);
      expect(p.portfolioIsPreset).toBe(false);
    });

    it("reports a custom portfolio as not a preset", () => {
      expect(buildDashboardPlan(plan(), { ...PORTFOLIO, isPreset: false }).portfolioIsPreset).toBe(false);
    });
  });
});
