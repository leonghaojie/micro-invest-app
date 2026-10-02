/**
 * PlanService unit tests — DECISIONS.md #1 third amendment (25 Aug 2026),
 * replacing simulation.service.test.ts. Two layers:
 *  - computePlanMonths: the pure engine core, tested directly with fake
 *    return maps (single fund, multi-fund blending, wallet arithmetic) —
 *    NFR-04 (reproducibility) is the one property every case here nails
 *    down, same as the old engine's tests.
 *  - PlanService.startPlan/getActivePlan: Prisma is mocked so these run
 *    without a live Postgres connection.
 */
import { prisma } from "../config/prisma";
import { computePlanMonths, planService } from "./plan.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    userProfile: { findUnique: jest.fn() },
    portfolio: { findUnique: jest.fn() },
    plan: { findUnique: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
    planMonth: { upsert: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  userProfile: { findUnique: jest.Mock };
  portfolio: { findUnique: jest.Mock };
  plan: { findUnique: jest.Mock; deleteMany: jest.Mock; create: jest.Mock };
  planMonth: { upsert: jest.Mock };
};

describe("computePlanMonths", () => {
  it("compounds a single fund's real monthly returns with a constant contribution", () => {
    const points = computePlanMonths({
      contributionAmount: 100,
      monthlyIncome: 1000,
      monthlyExpense: 700,
      startMonth: new Date("2026-01-01T00:00:00Z"),
      endMonth: new Date("2026-03-01T00:00:00Z"),
      allocations: [
        {
          weightPct: 100,
          ticker: "TEST",
          returnsByMonth: new Map([
            ["2026-01", 0.01],
            ["2026-02", -0.02],
            ["2026-03", 0.03],
          ]),
          earliestMonth: new Date("2026-01-01T00:00:00Z"),
          latestMonth: new Date("2026-03-01T00:00:00Z"),
        },
      ],
    });

    // Jan: (0 + 100) * 1.01 = 101
    // Feb: (101 + 100) * 0.98 = 196.98
    // Mar: (196.98 + 100) * 1.03 = 305.8894 -> 305.89
    expect(points).toHaveLength(3);
    expect(points[0].endingBalance).toBe(101);
    expect(points[1].endingBalance).toBe(196.98);
    expect(points[2].endingBalance).toBe(305.89);
    expect(points[2].totalInvested).toBe(300);
  });

  it("blends multiple funds by portfolio weight", () => {
    const points = computePlanMonths({
      contributionAmount: 100,
      monthlyIncome: 1000,
      monthlyExpense: 500,
      startMonth: new Date("2026-01-01T00:00:00Z"),
      endMonth: new Date("2026-01-01T00:00:00Z"),
      allocations: [
        {
          weightPct: 60,
          ticker: "A",
          returnsByMonth: new Map([["2026-01", 0.10]]),
          earliestMonth: new Date("2026-01-01T00:00:00Z"),
          latestMonth: new Date("2026-01-01T00:00:00Z"),
        },
        {
          weightPct: 40,
          ticker: "B",
          returnsByMonth: new Map([["2026-01", -0.05]]),
          earliestMonth: new Date("2026-01-01T00:00:00Z"),
          latestMonth: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    // Rp,t = 0.6*0.10 + 0.4*-0.05 = 0.04
    expect(points[0].portfolioReturnPct).toBe(0.04);
    expect(points[0].endingBalance).toBe(104); // (0+100)*1.04
  });

  it("accumulates the wallet balance from income - expense - contribution each month", () => {
    const points = computePlanMonths({
      contributionAmount: 100,
      monthlyIncome: 1000,
      monthlyExpense: 700,
      startMonth: new Date("2026-01-01T00:00:00Z"),
      endMonth: new Date("2026-02-01T00:00:00Z"),
      allocations: [
        {
          weightPct: 100,
          ticker: "TEST",
          returnsByMonth: new Map([
            ["2026-01", 0],
            ["2026-02", 0],
          ]),
          earliestMonth: new Date("2026-01-01T00:00:00Z"),
          latestMonth: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    });

    // Each month: 1000 - 700 - 100 = 200 added to the wallet.
    expect(points[0].walletBalance).toBe(200);
    expect(points[1].walletBalance).toBe(400);
  });

  it("throws if a fund is missing return data inside the requested span", () => {
    expect(() =>
      computePlanMonths({
        contributionAmount: 100,
        monthlyIncome: 1000,
        monthlyExpense: 500,
        startMonth: new Date("2026-01-01T00:00:00Z"),
        endMonth: new Date("2026-02-01T00:00:00Z"),
        allocations: [
          {
            weightPct: 100,
            ticker: "GAPPY",
            returnsByMonth: new Map([["2026-01", 0.01]]), // missing Feb
            earliestMonth: new Date("2026-01-01T00:00:00Z"),
            latestMonth: new Date("2026-02-01T00:00:00Z"),
          },
        ],
      })
    ).toThrow(/missing return data/);
  });
});

function fundReturns(months: [string, number][]) {
  return months.map(([m, r]) => ({ monthDate: new Date(`${m}-01T00:00:00Z`), returnPct: String(r) }));
}

describe("PlanService", () => {
  describe("startPlan", () => {
    it("404s when the user has no profile set up", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(
        planService.startPlan("user-1", { portfolioId: "11111111-1111-1111-1111-111111111111", contributionAmount: 100, startMonth: "2026-01-01" })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("422s when the contribution exceeds monthly income", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({ monthlyIncome: "500.00", monthlyExpense: "300.00" });

      await expect(
        planService.startPlan("user-1", { portfolioId: "11111111-1111-1111-1111-111111111111", contributionAmount: 600, startMonth: "2026-01-01" })
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it("404s when the portfolio doesn't exist", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({ monthlyIncome: "1000.00", monthlyExpense: "500.00" });
      mockedPrisma.portfolio.findUnique.mockResolvedValue(null);

      await expect(
        planService.startPlan("user-1", { portfolioId: "11111111-1111-1111-1111-111111111111", contributionAmount: 100, startMonth: "2026-01-01" })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("422s when the requested start month predates a fund's real data", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({ monthlyIncome: "1000.00", monthlyExpense: "500.00" });
      mockedPrisma.portfolio.findUnique.mockResolvedValue({
        id: "pf-1",
        name: "Growth",
        userId: null,
        allocations: [
          { weightPct: "100.00", fund: { ticker: "ES3.SI", monthlyReturns: fundReturns([["2020-01", 0.01], ["2020-02", 0.02]]) } },
        ],
      });

      await expect(
        planService.startPlan("user-1", { portfolioId: "11111111-1111-1111-1111-111111111111", contributionAmount: 100, startMonth: "2019-01-01" })
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it("creates the plan and its months on a valid request", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({ monthlyIncome: "1000.00", monthlyExpense: "500.00" });
      mockedPrisma.portfolio.findUnique.mockResolvedValue({
        id: "pf-1",
        name: "Growth",
        userId: null,
        allocations: [
          { weightPct: "100.00", fund: { ticker: "ES3.SI", monthlyReturns: fundReturns([["2026-01", 0.01], ["2026-02", 0.02]]) } },
        ],
      });
      mockedPrisma.plan.deleteMany.mockResolvedValue({ count: 0 });
      mockedPrisma.plan.create.mockResolvedValue({ id: "plan-1" });

      jest.useFakeTimers().setSystemTime(new Date("2026-02-15T00:00:00Z"));
      const result = await planService.startPlan("user-1", {
        portfolioId: "11111111-1111-1111-1111-111111111111",
        contributionAmount: 100,
        startMonth: "2026-01-01",
      });
      jest.useRealTimers();

      expect(mockedPrisma.plan.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(result.planId).toBe("plan-1");
      expect(result.months).toHaveLength(2);
      expect(result.finalValue).toBe(result.months[1].endingBalance);
    });
  });

  describe("getActivePlan", () => {
    it("returns null when the user has no active plan", async () => {
      mockedPrisma.plan.findUnique.mockResolvedValue(null);

      const result = await planService.getActivePlan("user-1");

      expect(result).toBeNull();
    });
  });
});
