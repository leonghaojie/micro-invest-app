/**
 * PortfolioService — FR04 (browse funds) plus the DECISIONS.md #1 second
 * amendment: users compose their own multi-fund Portfolio (weighted
 * allocations across one or more Funds) rather than picking a fixed
 * single-fund template. System presets (Portfolio.userId null) remain
 * available as quick-start options with the same shape as a custom one.
 */
import { z } from "zod";
import { prisma } from "../config/prisma";
import { buildFundHistory, FundHistory, MonthlyRow, RANGE_KEYS } from "../utils/fundStats";
import { HttpError } from "../utils/httpError";
import { blendFundReturns } from "../utils/portfolioBlend";
import { presetInfo } from "../utils/presetPortfolios";

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

/** One portfolio's page (DECISIONS.md #28): what it is, what it holds, and how it would have done. */
export interface PortfolioDetail extends FundHistory {
  portfolio: {
    id: string;
    name: string;
    isPreset: boolean;
    riskLevel: string | null;
    tagline: string | null;
    highlights: string[] | null;
    suits: string | null;
    riskNote: string | null;
  };
  /** The whole common history, whatever range is chosen: the same figures the list shows. */
  overall: PortfolioHistorySummary & { startMonth: string; endMonth: string };
  composition: { fundId: string; ticker: string; name: string; assetClass: string; exchange: string; currency: string; weightPct: number; earliestMonth: string | null }[];
  assetMix: { assetClass: string; pct: number }[];
  /** The fund whose short history limits how far back the figures go, or null when they have the same start. */
  limitedBy: { ticker: string; earliestMonth: string } | null;
  /** True when the funds are in more than one currency: the figures take no account of exchange rates. */
  mixedCurrencies: boolean;
}

export interface PortfolioAllocationSummary {
  fundId: string;
  ticker: string;
  fundName: string;
  assetClass: string;
  weightPct: number;
}

/** How a portfolio has done in the past, in one line for the list (DECISIONS.md #28). */
export interface PortfolioHistorySummary {
  /** null with fewer than 12 months of common history. */
  annualizedReturnPct: number | null;
  /** The worst fall from a high, zero or negative. */
  maxDrawdownPct: number;
  months: number;
}

export interface PortfolioSummary {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  /** One line about a preset; null for a custom mix. */
  tagline: string | null;
  /** The backtest of its funds' history, or null if a fund has no data yet. */
  history: PortfolioHistorySummary | null;
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

const portfolioDetailSchema = z.object({
  id: z.string().uuid(),
  range: z.enum(RANGE_KEYS as [string, ...string[]]).default("5y"),
});

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

    const fundIds = portfolios.flatMap((p) => p.allocations.map((a) => a.fundId));
    const [firstMonths, rowsByFund] = await Promise.all([firstMonthByFund(fundIds), loadFundRows(fundIds)]);
    return portfolios.map((p) => toPortfolioSummary(p, firstMonths, rowsByFund));
  }

  /**
   * One portfolio's page: its description (presets), its funds, and its history over a range
   * (default 5y), worked out by blending its funds' monthly returns (utils/portfolioBlend.ts). A preset is
   * open to everyone; a custom mix only to its owner, and anyone else gets the same 404 as for a
   * portfolio that does not exist.
   */
  async getPortfolioDetail(userId: string, id: string, range?: unknown): Promise<PortfolioDetail> {
    const parsed = portfolioDetailSchema.parse({ id, range });
    const portfolio = await prisma.portfolio.findUnique({ where: { id: parsed.id }, include: { allocations: { include: { fund: true } } } });
    if (!portfolio || (!portfolio.isPreset && portfolio.userId !== userId)) throw new HttpError(404, "Portfolio not found");

    const fundIds = portfolio.allocations.map((a) => a.fundId);
    const rowsByFund = await loadFundRows(fundIds);
    const series = portfolio.allocations.map((a) => ({ weightPct: Number(a.weightPct), rows: rowsByFund.get(a.fundId) ?? [] }));
    const blended = blendFundReturns(series);
    if (blended.rows.length === 0) throw new HttpError(404, "No history available for this portfolio yet");

    const history = buildFundHistory(blended.rows, parsed.range as (typeof RANGE_KEYS)[number]);
    const whole = buildFundHistory(blended.rows, "max");
    const info = portfolio.isPreset ? presetInfo(portfolio.name) : null;

    const composition = portfolio.allocations
      .map((a) => ({
        fundId: a.fundId,
        ticker: a.fund.ticker,
        name: a.fund.name,
        assetClass: a.fund.assetClass,
        exchange: a.fund.exchange,
        currency: a.fund.currency,
        weightPct: Number(a.weightPct),
        earliestMonth: (rowsByFund.get(a.fundId) ?? [])[0]?.month ?? null,
      }))
      .sort((x, y) => y.weightPct - x.weightPct || x.ticker.localeCompare(y.ticker));

    const byClass = new Map<string, number>();
    for (const c of composition) byClass.set(c.assetClass, round2((byClass.get(c.assetClass) ?? 0) + c.weightPct));

    // The fund that starts latest decides how far back the blend goes.
    const starts = composition.map((c) => c.earliestMonth).filter((m): m is string => m !== null);
    const latestStart = starts.reduce((max, m) => (m > max ? m : max), starts[0]);
    const limiting = composition.find((c) => c.earliestMonth === latestStart);
    const sameStart = starts.every((m) => m === starts[0]);

    return {
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        isPreset: portfolio.isPreset,
        riskLevel: portfolio.riskLevel,
        tagline: info?.tagline ?? null,
        highlights: info ? [...info.highlights] : null,
        suits: info?.suits ?? null,
        riskNote: info?.riskNote ?? null,
      },
      overall: { annualizedReturnPct: whole.stats.annualizedReturnPct, maxDrawdownPct: whole.stats.maxDrawdownPct, months: whole.months, startMonth: whole.startMonth, endMonth: whole.endMonth },
      composition,
      assetMix: [...byClass.entries()].map(([assetClass, pct]) => ({ assetClass, pct })).sort((a, b) => b.pct - a.pct),
      limitedBy: !sameStart && limiting && limiting.earliestMonth ? { ticker: limiting.ticker, earliestMonth: limiting.earliestMonth } : null,
      mixedCurrencies: new Set(composition.map((c) => c.currency)).size > 1,
      ...history,
      // A portfolio's funds' dividends are inside their total returns; a yield figure would be wrong.
      trailingYieldPct: null,
    };
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

    return toPortfolioSummary(portfolio, await firstMonthByFund(fundIds), await loadFundRows(fundIds));
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

/** Every stored month of each fund, oldest first. */
async function loadFundRows(fundIds: string[]): Promise<Map<string, MonthlyRow[]>> {
  const unique = [...new Set(fundIds)];
  const out = new Map<string, MonthlyRow[]>();
  if (unique.length === 0) return out;
  const rows = await prisma.fundMonthlyReturn.findMany({
    where: { fundId: { in: unique } },
    select: { fundId: true, monthDate: true, endPrice: true, dividendAmount: true, returnPct: true },
    orderBy: { monthDate: "asc" },
  });
  for (const r of rows) {
    const list = out.get(r.fundId) ?? [];
    list.push({ month: r.monthDate.toISOString().slice(0, 7), endPrice: Number(r.endPrice), dividend: Number(r.dividendAmount), returnPct: Number(r.returnPct) });
    out.set(r.fundId, list);
  }
  return out;
}

/** Pure. The one-line history of an allocation, or null if any fund has no data. */
export function summarizeHistory(allocations: { fundId: string; weightPct: number }[], rowsByFund: Map<string, MonthlyRow[]>): PortfolioHistorySummary | null {
  const blended = blendFundReturns(allocations.map((a) => ({ weightPct: a.weightPct, rows: rowsByFund.get(a.fundId) ?? [] })));
  if (blended.rows.length === 0) return null;
  const { stats, months } = buildFundHistory(blended.rows, "max");
  return { annualizedReturnPct: stats.annualizedReturnPct, maxDrawdownPct: stats.maxDrawdownPct, months };
}

function toPortfolioSummary(
  portfolio: {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  allocations: { fundId: string; weightPct: unknown; fund: { ticker: string; name: string; assetClass: string } }[];
  },
  firstMonths: Map<string, string>,
  rowsByFund: Map<string, MonthlyRow[]>
): PortfolioSummary {
  const starts = portfolio.allocations.map((a) => firstMonths.get(a.fundId));
  return {
    id: portfolio.id,
    name: portfolio.name,
    isPreset: portfolio.isPreset,
    riskLevel: portfolio.riskLevel,
    tagline: portfolio.isPreset ? presetInfo(portfolio.name)?.tagline ?? null : null,
    history: summarizeHistory(
      portfolio.allocations.map((a) => ({ fundId: a.fundId, weightPct: Number(a.weightPct) })),
      rowsByFund
    ),
    earliestStartMonth: starts.length === 0 || starts.some((m) => m === undefined) ? null : (starts as string[]).reduce((max, m) => (m > max ? m : max)),
    allocations: portfolio.allocations.map((a) => ({
      fundId: a.fundId,
      ticker: a.fund.ticker,
      fundName: a.fund.name,
      assetClass: a.fund.assetClass,
      weightPct: Number(a.weightPct),
    })),
  };
}

export const portfolioService = new PortfolioService();
