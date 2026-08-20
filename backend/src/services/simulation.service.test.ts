/**
 * SimulationService unit tests — FR05/FR06/FR07. Prisma is mocked so these
 * run without a live Postgres connection and pin down the deterministic
 * compounding formula (DECISIONS.md #1, and its two amendments — real
 * historical returns, then multi-fund weighted blending) against
 * hand-computed values.
 */
import { prisma } from "../config/prisma";
import { simulationService } from "./simulation.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    portfolio: { findUnique: jest.fn() },
    simulation: { create: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  portfolio: { findUnique: jest.Mock };
  simulation: { create: jest.Mock };
};

interface FundFixture {
  ticker: string;
  weightPct: string;
  returns: string[]; // ascending by year, starting 2016
}

function mockPortfolio(opts: { userId: string | null; funds: FundFixture[] }) {
  mockedPrisma.portfolio.findUnique.mockResolvedValue({
    id: "portfolio-1",
    userId: opts.userId,
    allocations: opts.funds.map((f, i) => ({
      fundId: `fund-${i}`,
      weightPct: f.weightPct,
      fund: {
        id: `fund-${i}`,
        ticker: f.ticker,
        historicalReturns: f.returns.map((returnRate, yearIdx) => ({ year: 2016 + yearIdx, returnRate })),
      },
    })),
  });
}

function mockCreate() {
  mockedPrisma.simulation.create.mockImplementation(({ data }) =>
    Promise.resolve({ id: "sim-1", ...data, contributions: undefined })
  );
}

const PORTFOLIO_ID = "11111111-1111-1111-1111-111111111111";

describe("SimulationService", () => {
  describe("run", () => {
    it("404s when the portfolio doesn't exist", async () => {
      mockedPrisma.portfolio.findUnique.mockResolvedValue(null);

      await expect(
        simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 12,
        })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(mockedPrisma.simulation.create).not.toHaveBeenCalled();
    });

    it("404s when the portfolio is a private custom one belonging to another user", async () => {
      mockPortfolio({ userId: "someone-else", funds: [{ ticker: "ES3", weightPct: "100.00", returns: ["0.10"] }] });

      await expect(
        simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 1,
        })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("allows a preset portfolio (userId null) to be used by any user", async () => {
      mockPortfolio({ userId: null, funds: [{ ticker: "ES3", weightPct: "100.00", returns: ["0.00"] }] });
      mockCreate();

      await expect(
        simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 1,
        })
      ).resolves.toBeDefined();
    });

    it("rejects a non-positive contribution amount", async () => {
      await expect(
        simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 0,
          durationMonths: 12,
        })
      ).rejects.toThrow();
      expect(mockedPrisma.portfolio.findUnique).not.toHaveBeenCalled();
    });

    it("422s when a fund in the portfolio has no historical return data", async () => {
      mockPortfolio({
        userId: "user-1",
        funds: [
          { ticker: "ES3", weightPct: "50.00", returns: ["0.10"] },
          { ticker: "NEW", weightPct: "50.00", returns: [] },
        ],
      });

      await expect(
        simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 1,
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(mockedPrisma.simulation.create).not.toHaveBeenCalled();
    });

    describe("single-fund portfolio (100% weight — matches the pre-multi-fund model exactly)", () => {
      it("at 0% return, final value equals total contributed exactly", async () => {
        mockPortfolio({ userId: "user-1", funds: [{ ticker: "ES3", weightPct: "100.00", returns: ["0.00"] }] });
        mockCreate();

        const result = await simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 50,
          durationMonths: 6,
        });

        expect(result.finalValue).toBe(300);
        expect(result.totalContributed).toBe(300);
        expect(result.growth).toBe(0);
        expect(result.historyWrapped).toBe(false);
      });

      it("derives the periodic rate geometrically from a real annual return", async () => {
        // periodicRate = 1.10^(1/12) - 1 ≈ 0.0079741404
        // after 1 period: 100 * (1 + periodicRate) = 100.7974... -> 100.80
        mockPortfolio({ userId: "user-1", funds: [{ ticker: "ES3", weightPct: "100.00", returns: ["0.10"] }] });
        mockCreate();

        const result = await simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 1,
        });

        expect(result.finalValue).toBe(100.8);
      });
    });

    describe("multi-fund weighted blending (DECISIONS.md #1 second amendment)", () => {
      it("blends two funds' periodic rates by their portfolio weight", async () => {
        // Fund A 10% annual @ 50%, Fund B 20% annual @ 50%
        // blendedRate = 0.5*(1.10^(1/12)-1) + 0.5*(1.20^(1/12)-1) ≈ 0.0116418055
        // after 1 period: 100 * 1.0116418... = 101.1641... -> 101.16
        mockPortfolio({
          userId: "user-1",
          funds: [
            { ticker: "A", weightPct: "50.00", returns: ["0.10"] },
            { ticker: "B", weightPct: "50.00", returns: ["0.20"] },
          ],
        });
        mockCreate();

        const result = await simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 1,
        });

        expect(result.finalValue).toBe(101.16);
      });

      it("compounds the blended rate over multiple periods", async () => {
        mockPortfolio({
          userId: "user-1",
          funds: [
            { ticker: "A", weightPct: "50.00", returns: ["0.10"] },
            { ticker: "B", weightPct: "50.00", returns: ["0.20"] },
          ],
        });
        mockCreate();

        const result = await simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 2,
        });

        expect(result.finalValue).toBe(203.51);
      });

      it("wraps each fund's history independently, based on its own series length", async () => {
        // Fund A: 1 year of history [10%] -> wraps every year.
        // Fund B: 2 years [10%, 20%] -> doesn't wrap within this plan.
        // Over 24 monthly periods (2 years): year 0 both use their own
        // year-0 rate (10%/10%); year 1, A wraps back to 10% again while
        // B genuinely progresses to its 20% year.
        mockPortfolio({
          userId: "user-1",
          funds: [
            { ticker: "A", weightPct: "50.00", returns: ["0.10"] },
            { ticker: "B", weightPct: "50.00", returns: ["0.10", "0.20"] },
          ],
        });
        mockCreate();

        const result = await simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 24,
        });

        expect(result.finalValue).toBe(2747.2);
        expect(result.historyWrapped).toBe(true); // Fund A wrapped even though Fund B didn't
      });

      it("does not flag historyWrapped when every fund's series covers the full plan", async () => {
        mockPortfolio({
          userId: "user-1",
          funds: [
            { ticker: "A", weightPct: "50.00", returns: ["0.10", "0.20"] },
            { ticker: "B", weightPct: "50.00", returns: ["0.10", "0.20"] },
          ],
        });
        mockCreate();

        const result = await simulationService.run("user-1", {
          portfolioId: PORTFOLIO_ID,
          frequency: "MONTHLY",
          contributionAmount: 100,
          durationMonths: 24,
        });

        expect(result.historyWrapped).toBe(false);
      });
    });

    it("persists one Contribution row per period, same shape as before", async () => {
      mockPortfolio({ userId: "user-1", funds: [{ ticker: "ES3", weightPct: "100.00", returns: ["0.00"] }] });
      mockCreate();

      await simulationService.run("user-1", {
        portfolioId: PORTFOLIO_ID,
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

    it("derives a WEEKLY period count from durationMonths (52/12 weeks per month)", async () => {
      mockPortfolio({ userId: "user-1", funds: [{ ticker: "ES3", weightPct: "100.00", returns: ["0.00"] }] });
      mockCreate();

      await simulationService.run("user-1", {
        portfolioId: PORTFOLIO_ID,
        frequency: "WEEKLY",
        contributionAmount: 10,
        durationMonths: 1,
      });

      const createArgs = mockedPrisma.simulation.create.mock.calls[0][0];
      expect(createArgs.data.contributions.createMany.data).toHaveLength(4); // round(52/12) = 4
    });
  });
});
