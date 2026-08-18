/**
 * PortfolioService unit tests — FR04. Prisma is mocked so these run
 * without a live Postgres connection.
 */
import { prisma } from "../config/prisma";
import { portfolioService } from "./portfolio.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    portfolioTemplate: {
      findMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  portfolioTemplate: { findMany: jest.Mock };
};

describe("PortfolioService", () => {
  it("lists templates ordered by expected return, converting Decimal to number", async () => {
    mockedPrisma.portfolioTemplate.findMany.mockResolvedValue([
      { id: "t1", name: "Conservative", riskLevel: "LOW", expectedReturn: "0.0400", volatility: "0.0500" },
      { id: "t2", name: "Growth", riskLevel: "HIGH", expectedReturn: "0.1000", volatility: "0.2000" },
    ]);

    const result = await portfolioService.listTemplates();

    expect(mockedPrisma.portfolioTemplate.findMany).toHaveBeenCalledWith({ orderBy: { expectedReturn: "asc" } });
    expect(result).toEqual([
      { id: "t1", name: "Conservative", riskLevel: "LOW", expectedReturn: 0.04 },
      { id: "t2", name: "Growth", riskLevel: "HIGH", expectedReturn: 0.1 },
    ]);
  });

  it("returns an empty list when no templates exist yet", async () => {
    mockedPrisma.portfolioTemplate.findMany.mockResolvedValue([]);

    const result = await portfolioService.listTemplates();

    expect(result).toEqual([]);
  });
});
