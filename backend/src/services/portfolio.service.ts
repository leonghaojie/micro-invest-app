/**
 * PortfolioService — FR04 (browse funds) plus the DECISIONS.md #1 second
 * amendment: users compose their own multi-fund Portfolio (weighted
 * allocations across one or more Funds) rather than picking a fixed
 * single-fund template. System presets (Portfolio.userId null) remain
 * available as quick-start options with the same shape as a custom one.
 */
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

export interface FundSummary {
  id: string;
  ticker: string;
  name: string;
  assetClass: string;
  exchange: string;
  currency: string;
  yearsAvailable: number;
  latestAnnualReturn: number | null;
}

export interface PortfolioAllocationSummary {
  fundId: string;
  ticker: string;
  fundName: string;
  weightPct: number;
}

export interface PortfolioSummary {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  allocations: PortfolioAllocationSummary[];
}

const allocationInputSchema = z.object({
  fundId: z.string().uuid(),
  weightPct: z.number().positive().max(100),
});

const createPortfolioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  allocations: z.array(allocationInputSchema).min(1),
});

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;

const WEIGHT_SUM_TOLERANCE = 0.01;

class PortfolioService {
  async listFunds(): Promise<FundSummary[]> {
    const funds = await prisma.fund.findMany({
      include: { historicalReturns: { orderBy: { year: "desc" } } },
      orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
    });

    return funds.map((fund) => ({
      id: fund.id,
      ticker: fund.ticker,
      name: fund.name,
      assetClass: fund.assetClass,
      exchange: fund.exchange,
      currency: fund.currency,
      yearsAvailable: fund.historicalReturns.length,
      latestAnnualReturn: fund.historicalReturns[0] ? Number(fund.historicalReturns[0].returnRate) : null,
    }));
  }

  async listPortfolios(userId: string): Promise<PortfolioSummary[]> {
    const portfolios = await prisma.portfolio.findMany({
      where: { OR: [{ isPreset: true }, { userId }] },
      include: { allocations: { include: { fund: true } } },
      orderBy: [{ isPreset: "desc" }, { createdAt: "asc" }],
    });

    return portfolios.map(toPortfolioSummary);
  }

  async createPortfolio(userId: string, input: unknown): Promise<PortfolioSummary> {
    const parsed = createPortfolioSchema.parse(input);

    const totalWeight = parsed.allocations.reduce((sum, a) => sum + a.weightPct, 0);
    if (Math.abs(totalWeight - 100) > WEIGHT_SUM_TOLERANCE) {
      throw new HttpError(400, `Allocation weights must sum to 100 (got ${round2(totalWeight)})`);
    }

    const fundIds = parsed.allocations.map((a) => a.fundId);
    const uniqueFundIds = new Set(fundIds);
    if (uniqueFundIds.size !== fundIds.length) {
      throw new HttpError(400, "Each fund can only appear once in a portfolio's allocations");
    }

    const funds = await prisma.fund.findMany({ where: { id: { in: fundIds } } });
    if (funds.length !== uniqueFundIds.size) {
      throw new HttpError(400, "One or more selected funds don't exist");
    }

    const portfolio = await prisma.portfolio.create({
      data: {
        userId,
        name: parsed.name,
        isPreset: false,
        allocations: {
          createMany: {
            data: parsed.allocations.map((a) => ({ fundId: a.fundId, weightPct: a.weightPct })),
          },
        },
      },
      include: { allocations: { include: { fund: true } } },
    });

    return toPortfolioSummary(portfolio);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPortfolioSummary(portfolio: {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  allocations: { fundId: string; weightPct: unknown; fund: { ticker: string; name: string } }[];
}): PortfolioSummary {
  return {
    id: portfolio.id,
    name: portfolio.name,
    isPreset: portfolio.isPreset,
    riskLevel: portfolio.riskLevel,
    allocations: portfolio.allocations.map((a) => ({
      fundId: a.fundId,
      ticker: a.fund.ticker,
      fundName: a.fund.name,
      weightPct: Number(a.weightPct),
    })),
  };
}

export const portfolioService = new PortfolioService();
