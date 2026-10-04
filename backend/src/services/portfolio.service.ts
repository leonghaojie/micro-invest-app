/**
 * PortfolioService — FR04 (browse funds) plus the DECISIONS.md #1 second
 * amendment: users compose their own multi-fund Portfolio (weighted
 * allocations across one or more Funds) rather than picking a fixed
 * single-fund template. System presets (Portfolio.userId null) remain
 * available as quick-start options with the same shape as a custom one.
 */
import { z } from "zod";
import { prisma } from "../config/prisma";
import { buildFundHistory, FundHistory, RANGE_KEYS } from "../utils/fundStats";
import { HttpError } from "../utils/httpError";

export interface FundSummary {
  id: string;
  ticker: string;
  name: string;
  assetClass: string;
  exchange: string;
  currency: string;
  monthsAvailable: number;
  earliestMonth: string | null;
  /** Newest month with data ("YYYY-MM"); the app shows how current the data is. */
  latestMonth: string | null;
  latestMonthlyReturn: number | null;
}

/** One fund's identity plus its history and statistics (DECISIONS.md #14). */
export interface FundDetail extends FundHistory {
  fund: {
    id: string;
    ticker: string;
    name: string;
    assetClass: string;
    exchange: string;
    currency: string;
    monthsAvailable: number;
    earliestMonth: string;
  };
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
  /** The earliest month a plan on this portfolio can start ("YYYY-MM"): the latest of its
   * funds' first months, since a plan needs every fund's real return for every month. null
   * if a fund has no data yet. */
  earliestStartMonth: string | null;
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

const fundDetailSchema = z.object({
  id: z.string().uuid(),
  range: z.enum(RANGE_KEYS as [string, ...string[]]).default("5y"),
});

const WEIGHT_SUM_TOLERANCE = 0.01;

class PortfolioService {
  async listFunds(): Promise<FundSummary[]> {
    const funds = await prisma.fund.findMany({
      include: { monthlyReturns: { orderBy: { monthDate: "desc" } } },
      orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
    });

    return funds.map((fund) => ({
      id: fund.id,
      ticker: fund.ticker,
      name: fund.name,
      assetClass: fund.assetClass,
      exchange: fund.exchange,
      currency: fund.currency,
      monthsAvailable: fund.monthlyReturns.length,
      earliestMonth: fund.monthlyReturns.length > 0 ? fund.monthlyReturns[fund.monthlyReturns.length - 1].monthDate.toISOString().slice(0, 7) : null,
      latestMonth: fund.monthlyReturns[0] ? fund.monthlyReturns[0].monthDate.toISOString().slice(0, 7) : null,
      latestMonthlyReturn: fund.monthlyReturns[0] ? Number(fund.monthlyReturns[0].returnPct) : null,
    }));
  }

  /** History and statistics for one fund over a range (default 5y). Funds
   * are shared catalog data, not per-user, so this needs no ownership check. */
  async getFundDetail(fundId: string, range?: unknown): Promise<FundDetail> {
    const parsed = fundDetailSchema.parse({ id: fundId, range });

    const fund = await prisma.fund.findUnique({
      where: { id: parsed.id },
      include: { monthlyReturns: { orderBy: { monthDate: "asc" } } },
    });
    if (!fund) throw new HttpError(404, "Fund not found");
    if (fund.monthlyReturns.length === 0) throw new HttpError(404, "No history available for this fund yet");

    const rows = fund.monthlyReturns.map((m) => ({
      month: m.monthDate.toISOString().slice(0, 7),
      endPrice: Number(m.endPrice),
      dividend: Number(m.dividendAmount),
      returnPct: Number(m.returnPct),
    }));

    return {
      fund: {
        id: fund.id,
        ticker: fund.ticker,
        name: fund.name,
        assetClass: fund.assetClass,
        exchange: fund.exchange,
        currency: fund.currency,
        monthsAvailable: rows.length,
        earliestMonth: rows[0].month,
      },
      ...buildFundHistory(rows, parsed.range as (typeof RANGE_KEYS)[number]),
    };
  }

  async listPortfolios(userId: string): Promise<PortfolioSummary[]> {
    const portfolios = await prisma.portfolio.findMany({
      where: { OR: [{ isPreset: true }, { userId }] },
      include: { allocations: { include: { fund: true } } },
      orderBy: [{ isPreset: "desc" }, { createdAt: "asc" }],
    });

    const firstMonths = await firstMonthByFund(portfolios.flatMap((p) => p.allocations.map((a) => a.fundId)));
    return portfolios.map((p) => toPortfolioSummary(p, firstMonths));
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

    return toPortfolioSummary(portfolio, await firstMonthByFund(fundIds));
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Each fund's first month of real data, "YYYY-MM". A fund with no rows is absent. */
async function firstMonthByFund(fundIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(fundIds)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.fundMonthlyReturn.groupBy({ by: ["fundId"], where: { fundId: { in: unique } }, _min: { monthDate: true } });
  return new Map(rows.filter((r) => r._min.monthDate).map((r) => [r.fundId, r._min.monthDate!.toISOString().slice(0, 7)]));
}

function toPortfolioSummary(
  portfolio: {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  allocations: { fundId: string; weightPct: unknown; fund: { ticker: string; name: string } }[];
  },
  firstMonths: Map<string, string>
): PortfolioSummary {
  const starts = portfolio.allocations.map((a) => firstMonths.get(a.fundId));
  return {
    id: portfolio.id,
    name: portfolio.name,
    isPreset: portfolio.isPreset,
    riskLevel: portfolio.riskLevel,
    earliestStartMonth: starts.length === 0 || starts.some((m) => m === undefined) ? null : (starts as string[]).reduce((max, m) => (m > max ? m : max)),
    allocations: portfolio.allocations.map((a) => ({
      fundId: a.fundId,
      ticker: a.fund.ticker,
      fundName: a.fund.name,
      weightPct: Number(a.weightPct),
    })),
  };
}

export const portfolioService = new PortfolioService();
