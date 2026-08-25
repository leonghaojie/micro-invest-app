/**
 * DashboardService unit tests — FR08, rewritten for DECISIONS.md #1 third
 * amendment (25 Aug 2026): reads off plan.service.ts's one active plan
 * instead of a Simulation history; getBehaviour/ConsistencyScore is gone
 * (see dashboard.service.ts header). planService itself is mocked here —
 * dashboard.service.ts only reshapes its output, doesn't compute anything
 * new — with plan.service.test.ts owning the engine's own coverage.
 */
import { planService } from "./plan.service";
import { dashboardService } from "./dashboard.service";

jest.mock("./plan.service", () => ({
  planService: { getActivePlan: jest.fn() },
}));

const mockedPlanService = planService as unknown as { getActivePlan: jest.Mock };

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

    it("reshapes the active plan summary", async () => {
      mockedPlanService.getActivePlan.mockResolvedValue(PLAN_SUMMARY);

      const result = await dashboardService.getSummary("user-1");

      expect(result).toEqual({
        hasPlan: true,
        latestPlan: {
          planId: "plan-1",
          portfolioName: "Growth",
          startMonth: "2026-01-01",
          finalValue: 620.5,
          totalContributed: 600,
          growth: 20.5,
          walletBalance: 300,
        },
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
