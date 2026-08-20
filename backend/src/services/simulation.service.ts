/**
 * SimulationService — FR05, FR06, FR07 (run). FR13 (history) is Phase 7,
 * left as the pre-existing stub — getHistory below is unchanged.
 *
 * SRS §2.5 (locked v1.1, DECISIONS.md #1): deterministic compounding —
 *   balance[n] = (balance[n-1] + contributionAmount) * (1 + periodicRate)
 * with balance[-1] = 0. This satisfies NFR-04 (reproducibility) by
 * construction — identical inputs always produce identical output.
 *
 * DECISIONS.md #1 first amendment: periodicRate is derived from real,
 * dated HistoricalReturn rows rather than a constant expected return —
 * one sub-period rate per calendar year, wrapping back to the start of
 * the series once exhausted.
 *
 * DECISIONS.md #1 second amendment (multi-fund portfolios, this file):
 * a Simulation now runs against a Portfolio — one or more Funds, each
 * with its own weight (summing to 100%, validated at portfolio-creation
 * time by portfolio.service.ts). Each period's blended rate is the
 * weighted average of every fund's own periodic rate for that period —
 * i.e. the simplifying assumption that the portfolio rebalances back to
 * its target weights every period. This keeps a single balance/
 * Contribution-row-per-period shape (no per-fund sub-balances to track)
 * and stays fully deterministic (NFR-04 intact): every fund's return
 * series is static seed/ingested data, not live-fetched or randomly
 * resampled. A fund with zero HistoricalReturn rows makes the whole
 * simulation fail validation rather than silently defaulting to some
 * rate — unlike the single-fund model this replaces, there's no longer
 * a natural "expected return" constant to fall back to once a Fund
 * exists specifically to hold real returns.
 */
import { ContributionFrequency } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

const runSimulationSchema = z.object({
  portfolioId: z.string().uuid(),
  frequency: z.nativeEnum(ContributionFrequency),
  contributionAmount: z.number().positive(),
  // 600 months (50 years) is a sanity cap, not an SRS-defined limit.
  durationMonths: z.number().int().positive().max(600),
});

export type RunSimulationInput = z.infer<typeof runSimulationSchema>;

export interface RunSimulationResult {
  simulationId: string;
  finalValue: number;
  totalContributed: number;
  growth: number;
  // True when the plan's duration outlasted the real historical series for
  // any fund in the portfolio, so that fund's history was replayed from
  // its start to fill the remaining periods (mirrors how UC-05 surfaces
  // which peer-group fallback tier was used — transparency about what
  // actually drove the number, not just the number itself).
  historyWrapped: boolean;
}

export interface SimulationHistoryItem {
  id: string;
  portfolioName: string;
  frequency: ContributionFrequency;
  contributionAmount: number;
  durationMonths: number;
  finalValue: number | null;
  createdAt: string;
}

// Exported for reuse by dashboard.service.ts, which needs the same
// contribution-amount-times-periods derivation to reconstruct a past
// simulation's totalContributed (not itself persisted on Simulation).
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computePeriods(frequency: ContributionFrequency, durationMonths: number): number {
  return frequency === ContributionFrequency.WEEKLY ? Math.round((durationMonths * 52) / 12) : durationMonths;
}

function periodsPerYear(frequency: ContributionFrequency): number {
  return frequency === ContributionFrequency.WEEKLY ? 52 : 12;
}

// DECISIONS.md #1 amendment: a single *real* annual return compounds
// evenly across that year's periods — (1 + periodicRate)^periodsInYear =
// 1 + annualReturn — so each year's real figure is reproduced exactly by
// the end of that year.
function annualToPeriodicRate(annualReturn: number, periodsInYear: number): number {
  return Math.pow(1 + annualReturn, 1 / periodsInYear) - 1;
}

interface ContributionRow {
  periodIndex: number;
  amount: number;
  portfolioValue: number;
}

interface SimulationRunResult {
  contributions: ContributionRow[];
  finalValue: number;
  historyWrapped: boolean;
}

export interface FundAllocation {
  weightPct: number; // 0-100
  history: number[]; // annual returns, ascending by year
}

/** Looks up fund `history`'s periodic rate for a given period, wrapping
 * back to the start of the series once exhausted. Returns both the rate
 * and whether this lookup wrapped, so callers can OR it across funds. */
function lookupPeriodicRate(history: number[], periodIndex: number, periodsInYear: number): { rate: number; wrapped: boolean } {
  const yearOffset = Math.floor(periodIndex / periodsInYear);
  const yearIndex = yearOffset % history.length;
  return { rate: annualToPeriodicRate(history[yearIndex], periodsInYear), wrapped: yearOffset >= history.length };
}

/** Steps through each period, blending every fund's periodic rate by its
 * portfolio weight (rebalanced-every-period assumption — see file header)
 * and compounding the whole balance at that blended rate. */
function computeBlendedContributions(
  contributionAmount: number,
  allocations: FundAllocation[],
  periodsInYear: number,
  periods: number
): SimulationRunResult {
  const contributions: ContributionRow[] = [];
  let balance = 0;
  let historyWrapped = false;

  for (let periodIndex = 0; periodIndex < periods; periodIndex++) {
    let blendedRate = 0;
    for (const allocation of allocations) {
      const { rate, wrapped } = lookupPeriodicRate(allocation.history, periodIndex, periodsInYear);
      blendedRate += (allocation.weightPct / 100) * rate;
      if (wrapped) historyWrapped = true;
    }
    balance = (balance + contributionAmount) * (1 + blendedRate);
    contributions.push({ periodIndex, amount: contributionAmount, portfolioValue: round2(balance) });
  }

  return { contributions, finalValue: round2(balance), historyWrapped };
}

class SimulationService {
  async run(userId: string, input: unknown): Promise<RunSimulationResult> {
    const parsed = runSimulationSchema.parse(input);

    const portfolio = await prisma.portfolio.findUnique({
      where: { id: parsed.portfolioId },
      include: {
        allocations: {
          include: { fund: { include: { historicalReturns: { orderBy: { year: "asc" } } } } },
        },
      },
    });
    if (!portfolio) {
      throw new HttpError(404, "Portfolio not found");
    }
    // A user's own custom portfolio is private; presets (userId null) are
    // usable by anyone.
    if (portfolio.userId && portfolio.userId !== userId) {
      throw new HttpError(404, "Portfolio not found");
    }
    if (portfolio.allocations.length === 0) {
      throw new HttpError(400, "Portfolio has no fund allocations");
    }
    const emptyFund = portfolio.allocations.find((a) => a.fund.historicalReturns.length === 0);
    if (emptyFund) {
      throw new HttpError(422, `Fund ${emptyFund.fund.ticker} has no historical return data available yet`);
    }

    const periods = computePeriods(parsed.frequency, parsed.durationMonths);
    const periodsInYear = periodsPerYear(parsed.frequency);
    const allocations: FundAllocation[] = portfolio.allocations.map((a) => ({
      weightPct: Number(a.weightPct),
      history: a.fund.historicalReturns.map((h) => Number(h.returnRate)),
    }));

    const result = computeBlendedContributions(parsed.contributionAmount, allocations, periodsInYear, periods);

    const simulation = await prisma.simulation.create({
      data: {
        userId,
        portfolioId: parsed.portfolioId,
        frequency: parsed.frequency,
        contributionAmount: parsed.contributionAmount,
        durationMonths: parsed.durationMonths,
        finalValue: result.finalValue,
        contributions: { createMany: { data: result.contributions } },
      },
    });

    const totalContributed = round2(parsed.contributionAmount * periods);

    return {
      simulationId: simulation.id,
      finalValue: result.finalValue,
      totalContributed,
      growth: round2(result.finalValue - totalContributed),
      historyWrapped: result.historyWrapped,
    };
  }

  async getHistory(_userId: string): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}

export const simulationService = new SimulationService();
