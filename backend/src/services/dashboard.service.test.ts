/**
 * DashboardService unit tests — FR08. Prisma is mocked so these run
 * without a live Postgres connection. getBehaviour pins "now" via fake
 * timers since ConsistencyScore (DECISIONS.md #3) is defined relative to
 * the current month.
 */
import { prisma } from "../config/prisma";
import { dashboardService } from "./dashboard.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    simulation: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  simulation: { count: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
};

describe("DashboardService", () => {
  describe("getSummary", () => {
    it("reports no simulations for a brand-new user", async () => {
      mockedPrisma.simulation.count.mockResolvedValue(0);
      mockedPrisma.simulation.findFirst.mockResolvedValue(null);

      const result = await dashboardService.getSummary("user-1");

      expect(result).toEqual({ hasSimulations: false, totalSimulations: 0, latestSimulation: null });
    });

    it("derives totalContributed/growth for the latest simulation", async () => {
      mockedPrisma.simulation.count.mockResolvedValue(3);
      mockedPrisma.simulation.findFirst.mockResolvedValue({
        id: "sim-1",
        frequency: "MONTHLY",
        contributionAmount: "50",
        durationMonths: 6,
        finalValue: "320.50",
        createdAt: new Date("2024-06-01T00:00:00Z"),
        portfolio: { name: "Growth" },
      });

      const result = await dashboardService.getSummary("user-1");

      expect(result).toEqual({
        hasSimulations: true,
        totalSimulations: 3,
        latestSimulation: {
          simulationId: "sim-1",
          portfolioName: "Growth",
          finalValue: 320.5,
          totalContributed: 300, // 50 * 6 monthly periods
          growth: 20.5,
          createdAt: "2024-06-01T00:00:00.000Z",
        },
      });
    });
  });

  describe("getGrowth", () => {
    it("returns an empty series for a brand-new user", async () => {
      mockedPrisma.simulation.findFirst.mockResolvedValue(null);

      const result = await dashboardService.getGrowth("user-1");

      expect(result).toEqual({ simulationId: null, portfolioName: null, points: [] });
    });

    it("maps the latest simulation's contributions to a points series", async () => {
      mockedPrisma.simulation.findFirst.mockResolvedValue({
        id: "sim-1",
        portfolio: { name: "Balanced" },
        contributions: [
          { periodIndex: 0, portfolioValue: "50.00" },
          { periodIndex: 1, portfolioValue: "101.00" },
        ],
      });

      const result = await dashboardService.getGrowth("user-1");

      expect(result).toEqual({
        simulationId: "sim-1",
        portfolioName: "Balanced",
        points: [
          { periodIndex: 0, portfolioValue: 50 },
          { periodIndex: 1, portfolioValue: 101 },
        ],
      });
    });
  });

  describe("getBehaviour", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("scores 0 for a user with no simulations", async () => {
      mockedPrisma.simulation.findMany.mockResolvedValue([]);

      const result = await dashboardService.getBehaviour("user-1");

      expect(result).toEqual({ consistencyScore: 0, monthsWithActivity: 0, monthsSinceFirstRun: 0 });
    });

    it("cold-start: one simulation this month scores 100", async () => {
      jest.setSystemTime(new Date("2024-03-20T00:00:00Z"));
      mockedPrisma.simulation.findMany.mockResolvedValue([{ createdAt: new Date("2024-03-15T00:00:00Z") }]);

      const result = await dashboardService.getBehaviour("user-1");

      expect(result).toEqual({ consistencyScore: 100, monthsWithActivity: 1, monthsSinceFirstRun: 1 });
    });

    it("2 active months out of 3 elapsed scores 66.67", async () => {
      jest.setSystemTime(new Date("2024-03-31T00:00:00Z"));
      mockedPrisma.simulation.findMany.mockResolvedValue([
        { createdAt: new Date("2024-01-10T00:00:00Z") },
        { createdAt: new Date("2024-01-20T00:00:00Z") }, // same month as above — shouldn't double count
        { createdAt: new Date("2024-03-05T00:00:00Z") },
      ]);

      const result = await dashboardService.getBehaviour("user-1");

      expect(result).toEqual({ consistencyScore: 66.67, monthsWithActivity: 2, monthsSinceFirstRun: 3 });
    });
  });
});
