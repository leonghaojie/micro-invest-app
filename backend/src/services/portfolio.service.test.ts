/**
 * PortfolioService unit tests — FR04, plus the DECISIONS.md #1 second
 * amendment (multi-fund portfolios). Prisma is mocked so these run
 * without a live Postgres connection.
 */
import { prisma } from "../config/prisma";
import { portfolioService } from "./portfolio.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    fund: { findMany: jest.fn() },
    portfolio: { findMany: jest.fn(), create: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  fund: { findMany: jest.Mock };
  portfolio: { findMany: jest.Mock; create: jest.Mock };
};

describe("PortfolioService", () => {
  describe("listFunds", () => {
    it("summarises each fund with years available and its latest annual return", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([
        {
          id: "fund-1",
          ticker: "ES3",
          name: "SPDR Straits Times Index ETF",
          assetClass: "EQUITY",
          exchange: "SGX",
          currency: "SGD",
          historicalReturns: [
            { year: 2025, returnRate: "0.2814" },
            { year: 2024, returnRate: "0.2211" },
          ],
        },
      ]);

      const result = await portfolioService.listFunds();

      expect(result).toEqual([
        {
          id: "fund-1",
          ticker: "ES3",
          name: "SPDR Straits Times Index ETF",
          assetClass: "EQUITY",
          exchange: "SGX",
          currency: "SGD",
          yearsAvailable: 2,
          latestAnnualReturn: 0.2814,
        },
      ]);
    });

    it("reports null latestAnnualReturn for a fund with no historical data yet", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([
        {
          id: "fund-2",
          ticker: "NEW",
          name: "New Fund",
          assetClass: "EQUITY",
          exchange: "US",
          currency: "USD",
          historicalReturns: [],
        },
      ]);

      const result = await portfolioService.listFunds();

      expect(result[0]).toEqual(expect.objectContaining({ yearsAvailable: 0, latestAnnualReturn: null }));
    });
  });

  describe("listPortfolios", () => {
    it("returns presets and the user's own custom portfolios", async () => {
      mockedPrisma.portfolio.findMany.mockResolvedValue([
        {
          id: "pf-1",
          name: "Conservative",
          isPreset: true,
          riskLevel: "LOW",
          allocations: [{ fundId: "fund-1", weightPct: "100.00", fund: { ticker: "A35", name: "ABF Sg Bond" } }],
        },
      ]);

      const result = await portfolioService.listPortfolios("user-1");

      expect(mockedPrisma.portfolio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ isPreset: true }, { userId: "user-1" }] } })
      );
      expect(result).toEqual([
        {
          id: "pf-1",
          name: "Conservative",
          isPreset: true,
          riskLevel: "LOW",
          allocations: [{ fundId: "fund-1", ticker: "A35", fundName: "ABF Sg Bond", weightPct: 100 }],
        },
      ]);
    });
  });

  describe("createPortfolio", () => {
    it("creates a custom portfolio when weights sum to exactly 100", async () => {
      const fund1 = "11111111-1111-1111-1111-111111111111";
      const fund2 = "22222222-2222-2222-2222-222222222222";
      mockedPrisma.fund.findMany.mockResolvedValue([{ id: fund1 }, { id: fund2 }]);
      mockedPrisma.portfolio.create.mockResolvedValue({
        id: "pf-new",
        name: "My mix",
        isPreset: false,
        riskLevel: null,
        allocations: [
          { fundId: fund1, weightPct: "60.00", fund: { ticker: "ES3", name: "SPDR STI ETF" } },
          { fundId: fund2, weightPct: "40.00", fund: { ticker: "A35", name: "ABF Sg Bond" } },
        ],
      });

      const result = await portfolioService.createPortfolio("user-1", {
        name: "My mix",
        allocations: [
          { fundId: fund1, weightPct: 60 },
          { fundId: fund2, weightPct: 40 },
        ],
      });

      expect(result.allocations).toHaveLength(2);
      expect(mockedPrisma.portfolio.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "user-1", name: "My mix", isPreset: false }),
        })
      );
    });

    it("rejects weights that don't sum to 100", async () => {
      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Bad mix",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 60 },
            { fundId: "22222222-2222-2222-2222-222222222222", weightPct: 30 },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockedPrisma.portfolio.create).not.toHaveBeenCalled();
    });

    it("accepts weights within floating-point rounding tolerance of 100", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([{ id: "fund-1" }, { id: "fund-2" }, { id: "fund-3" }]);
      mockedPrisma.portfolio.create.mockResolvedValue({
        id: "pf-new",
        name: "Thirds",
        isPreset: false,
        riskLevel: null,
        allocations: [],
      });

      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Thirds",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 33.34 },
            { fundId: "22222222-2222-2222-2222-222222222222", weightPct: 33.33 },
            { fundId: "33333333-3333-3333-3333-333333333333", weightPct: 33.33 },
          ],
        })
      ).resolves.toBeDefined();
    });

    it("rejects a duplicate fund within the same portfolio", async () => {
      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Dup",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 50 },
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 50 },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects a fund id that doesn't exist", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([{ id: "fund-1" }]); // only 1 of 2 requested exists

      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Missing fund",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 50 },
            { fundId: "22222222-2222-2222-2222-222222222222", weightPct: 50 },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an empty allocations list", async () => {
      await expect(portfolioService.createPortfolio("user-1", { name: "Empty", allocations: [] })).rejects.toThrow();
    });
  });
});
