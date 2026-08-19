/**
 * SimulationService — FR05, FR06, FR07 (run). FR13 (history) is Phase 7,
 * left as the pre-existing stub — getHistory below is unchanged.
 *
 * SRS §2.5 (locked v1.1, DECISIONS.md #1): deterministic compounding —
 *   balance[n] = (balance[n-1] + contributionAmount) * (1 + periodicRate)
 * with balance[-1] = 0. This satisfies NFR-04 (reproducibility) by
 * construction — identical inputs always produce identical output.
 *
 * DECISIONS.md #1 AMENDMENT (see that file for the full dated entry):
 * periodicRate is no longer a single constant derived from
 * PortfolioTemplate.expectedReturn. It's now looked up from
 * HistoricalReturn — real, dated annual returns for the actual SGX-listed
 * fund each template is anchored to (A35 / CFA / ES3) — one sub-period
 * rate per calendar year in the series, wrapping back to the start of the
 * series for any period beyond its length. This is still fully
 * deterministic (NFR-04 intact): the series is static seed data, not
 * live-fetched or randomly resampled, so identical inputs still always
 * produce identical output. A template with no HistoricalReturn rows (e.g.
 * a future template added without sourced data) falls back to the old
 * constant-rate model off `expectedReturn`, so this degrades gracefully
 * rather than breaking.
 */
import { ContributionFrequency } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

const runSimulationSchema = z.object({
  templateId: z.string().uuid(),
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
  // this template, so history was replayed from its start to fill the
  // remaining periods (mirrors how UC-05 surfaces which peer-group
  // fallback tier was used — transparency about what actually drove the
  // number, not just the number itself).
  historyWrapped: boolean;
}

export interface SimulationHistoryItem {
  id: string;
  templateName: string;
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

// Original locked-model rate derivation (pre-amendment) — simple linear
// division, unchanged, so the no-historical-data fallback path below stays
// byte-for-byte identical to the model DECISIONS.md #1 originally locked.
function computeConstantPeriodicRate(annualExpectedReturn: number, periodsInYear: number): number {
  return annualExpectedReturn / periodsInYear;
}

// DECISIONS.md #1 amendment: a single *real* annual return compounds
// evenly across that year's periods — (1 + periodicRate)^periodsInYear =
// 1 + annualReturn — so each year's real figure is reproduced exactly by
// the end of that year, unlike the linear approximation above (which was
// only ever an assumption for an abstract "expected return", not a
// contract for reproducing a specific real annual figure).
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

/** Fallback for a template with no sourced HistoricalReturn rows — the
 * original constant-rate model, unchanged. */
function computeContributionsConstantRate(
  contributionAmount: number,
  periodicRate: number,
  periods: number
): SimulationRunResult {
  const contributions: ContributionRow[] = [];
  let balance = 0;
  for (let periodIndex = 0; periodIndex < periods; periodIndex++) {
    balance = (balance + contributionAmount) * (1 + periodicRate);
    contributions.push({ periodIndex, amount: contributionAmount, portfolioValue: round2(balance) });
  }
  return { contributions, finalValue: round2(balance), historyWrapped: false };
}

/** DECISIONS.md #1 amendment: steps through the real historical annual
 * return series year by year, deriving a periodic rate from each year's
 * actual return, wrapping (`% series.length`) once the series is
 * exhausted. `history` must be sorted ascending by year. */
function computeContributionsFromHistory(
  contributionAmount: number,
  history: number[],
  periodsInYear: number,
  periods: number
): SimulationRunResult {
  const contributions: ContributionRow[] = [];
  let balance = 0;
  for (let periodIndex = 0; periodIndex < periods; periodIndex++) {
    const yearIndex = Math.floor(periodIndex / periodsInYear) % history.length;
    const periodicRate = annualToPeriodicRate(history[yearIndex], periodsInYear);
    balance = (balance + contributionAmount) * (1 + periodicRate);
    contributions.push({ periodIndex, amount: contributionAmount, portfolioValue: round2(balance) });
  }
  const yearsSpanned = Math.ceil(periods / periodsInYear);
  return { contributions, finalValue: round2(balance), historyWrapped: yearsSpanned > history.length };
}

class SimulationService {
  async run(userId: string, input: unknown): Promise<RunSimulationResult> {
    const parsed = runSimulationSchema.parse(input);

    const template = await prisma.portfolioTemplate.findUnique({
      where: { id: parsed.templateId },
      include: { historicalReturns: { orderBy: { year: "asc" } } },
    });
    if (!template) {
      throw new HttpError(404, "Portfolio template not found");
    }

    const periods = computePeriods(parsed.frequency, parsed.durationMonths);
    const periodsInYear = periodsPerYear(parsed.frequency);

    const result =
      template.historicalReturns.length > 0
        ? computeContributionsFromHistory(
            parsed.contributionAmount,
            template.historicalReturns.map((h) => Number(h.returnRate)),
            periodsInYear,
            periods
          )
        : computeContributionsConstantRate(
            parsed.contributionAmount,
            computeConstantPeriodicRate(Number(template.expectedReturn), periodsInYear),
            periods
          );

    const simulation = await prisma.simulation.create({
      data: {
        userId,
        templateId: parsed.templateId,
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
