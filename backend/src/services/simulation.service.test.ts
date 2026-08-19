/**
 * SimulationService unit tests — FR05/FR06/FR07. Prisma is mocked so these
 * run without a live Postgres connection and pin down the deterministic
 * compounding formula (DECISIONS.md #1, and its amendment) against
 * hand-computed values.
 */
import { prisma } from "../config/prisma";
import { simulationService } from "./simulation.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    portfolioTemplate: { findUnique: jest.fn() },
    simulation: { create: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  portfolioTemplate: { findUnique: jest.Mock };
  simulation: { create: jest.Mock };
};

// No historicalReturns rows — exercises the pre-amendment constant-rate
// fallback, unchanged from the original locked model.
function mockTemplateWithoutHistory(expectedReturn: string) {
  mockedPrisma.portfolioTemplate.findUnique.mockResolvedValue({
    id: "template-1",
    name: "Test Template",
    riskLevel: "MEDIUM",
    expectedReturn,
    volatility: "0.1000",
    historicalReturns: [],
  });
}

// historicalReturns present — exercises the DECISIONS.md #1 amendment
// (real annual-return replay). `returns` is ascending by year.
function mockTemplateWithHistory(returns: string[]) {
  mockedPrisma.portfolioTemplate.findUnique.mockResolvedValue({
    id: "template-1",
    name: "Test Template",
    riskLevel: "MEDIUM",
    expectedReturn: "0.0700",
    volatility: "0.1000",
    historicalReturns: returns.map((returnRate, i) => ({ year: 2016 + i, returnRate })),
  });
}

function mockCreate() {
  mockedPrisma.simulation.create.mockImplementation(({ data }) =>
    Promise.resolve({ id: "sim-1", ...data, contributions: undefined })
  );
}

describe("SimulationService", () => {
  describe("run", () => {
    it("404s when the portfolio template doesn't exist", async () => {
      mockedPrisma.portfolioTemplate.findUnique.mockResolvedValue(null);

      await expect(
        simulationService.run("user-1", {
          templateId: "00000000-0000-0000-0000-000000000000",
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 12,
        })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(mockedPrisma.simulation.create).not.toHaveBeenCalled();
    });

    it("rejects a non-positive contribution amount", async () => {
      await expect(
        simulationService.run("user-1", {
          templateId: "00000000-0000-0000-0000-000000000000",
          frequency: "MONTHLY",
          contributionAmount: 0,
          durationMonths: 12,
        })
      ).rejects.toThrow();
      expect(mockedPrisma.portfolioTemplate.findUnique).not.toHaveBeenCalled();
    });

    describe("fallback: no HistoricalReturn rows (pre-amendment constant-rate model)", () => {
      it("at 0% expected return, final value equals total contributed exactly", async () => {
        mockTemplateWithoutHistory("0.0000");
        mockCreate();

        const result = await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 50,
          durationMonths: 6,
        });

        expect(result.finalValue).toBe(300);
        expect(result.totalContributed).toBe(300);
        expect(result.growth).toBe(0);
        expect(result.historyWrapped).toBe(false);
      });

      it("matches a hand-computed value for a 12% annual return over 2 monthly periods", async () => {
        // periodicRate = 0.12 / 12 = 0.01 (linear division, not geometric —
        // this is the original locked model's formula, unchanged)
        // n=0: (0 + 100) * 1.01 = 101
        // n=1: (101 + 100) * 1.01 = 203.01
        mockTemplateWithoutHistory("0.1200");
        mockCreate();

        const result = await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 2,
        });

        expect(result.finalValue).toBe(203.01);
        expect(result.totalContributed).toBe(200);
        expect(result.growth).toBe(3.01);
      });

      it("derives a WEEKLY period count from durationMonths (52/12 weeks per month)", async () => {
        mockTemplateWithoutHistory("0.0000");
        mockCreate();

        await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "WEEKLY",
          contributionAmount: 10,
          durationMonths: 1,
        });

        const createArgs = mockedPrisma.simulation.create.mock.calls[0][0];
        expect(createArgs.data.contributions.createMany.data).toHaveLength(4); // round(52/12) = 4
      });

      it("persists one Contribution row per period via nested createMany", async () => {
        mockTemplateWithoutHistory("0.0000");
        mockCreate();

        await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 25,
          durationMonths: 3,
        });

        const createArgs = mockedPrisma.simulation.create.mock.calls[0][0];
        expect(createArgs.data.contributions.createMany.data).toEqual([
          { periodIndex: 0, amount: 25, portfolioValue: 25 },
          { periodIndex: 1, amount: 25, portfolioValue: 50 },
          { periodIndex: 2, amount: 25, portfolioValue: 75 },
        ]);
      });
    });

    describe("DECISIONS.md #1 amendment: real historical-return replay", () => {
      it("derives the periodic rate geometrically so a full year reproduces the real annual return", async () => {
        // periodicRate = 1.10^(1/12) - 1 ≈ 0.0079741404
        // after 1 period: 100 * (1 + periodicRate) = 100.7974... -> 100.80
        mockTemplateWithHistory(["0.1000"]);
        mockCreate();

        const result = await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 1,
        });

        expect(result.finalValue).toBe(100.8);
      });

      it("walks through consecutive real years without wrapping when duration fits the series", async () => {
        // year 0 = 10%, year 1 = 20%, monthly, 24 periods = exactly 2 years
        mockTemplateWithHistory(["0.1000", "0.2000"]);
        mockCreate();

        const result = await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 24,
        });

        expect(result.finalValue).toBe(2843.25);
        expect(result.historyWrapped).toBe(false);
      });

      it("wraps back to the start of the series once it's exhausted, and flags historyWrapped", async () => {
        // only 1 real year of history, but a 24-month (2-year) plan —
        // year 2 replays year 0's real return again.
        mockTemplateWithHistory(["0.1000"]);
        mockCreate();

        const result = await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 24,
        });

        expect(result.finalValue).toBe(2654.51);
        expect(result.historyWrapped).toBe(true);
      });

      it("does not flag historyWrapped for a plan shorter than the available history", async () => {
        mockTemplateWithHistory(["0.1000", "0.2000", "-0.0500"]);
        mockCreate();

        const result = await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 6,
        });

        expect(result.historyWrapped).toBe(false);
      });

      it("persists one Contribution row per period, same shape as the fallback path", async () => {
        mockTemplateWithHistory(["0.0000"]);
        mockCreate();

        await simulationService.run("user-1", {
          templateId: "11111111-1111-1111-1111-111111111111",
          frequency: "MONTHLY",
          contributionAmount: 25,
          durationMonths: 3,
        });

        const createArgs = mockedPrisma.simulation.create.mock.calls[0][0];
        expect(createArgs.data.contributions.createMany.data).toEqual([
          { periodIndex: 0, amount: 25, portfolioValue: 25 },
          { periodIndex: 1, amount: 25, portfolioValue: 50 },
          { periodIndex: 2, amount: 25, portfolioValue: 75 },
        ]);
      });
    });
  });
});
