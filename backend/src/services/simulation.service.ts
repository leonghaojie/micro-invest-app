/**
 * SimulationService — FR05, FR06, FR07 (run). FR13 (history) is Phase 7,
 * left as the pre-existing stub — getHistory below is unchanged.
 *
 * SRS §2.5 (locked v1.1, DECISIONS.md #1): deterministic fixed-rate
 * compounding —
 *   balance[n] = (balance[n-1] + contributionAmount) * (1 + periodicRate)
 * with balance[-1] = 0. No stochastic/volatility modelling in the MVP
 * (satisfies NFR-04 by construction — identical inputs always produce
 * identical output).
 *
 * ⚠️ ASSUMPTION (not specified in DECISIONS.md, which locks the recursive
 * formula but not how periodicRate/period-count are derived from the
 * template's annual expectedReturn + contribution frequency + duration):
 * expectedReturn is treated as a nominal annual rate, divided by periods
 * per year (12 for MONTHLY, 52 for WEEKLY) to get periodicRate. Period
 * count for WEEKLY is round(durationMonths * 52 / 12). Revisit against the
 * SRS Data Dictionary if this doesn't match the locked definition.
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computePeriods(frequency: ContributionFrequency, durationMonths: number): number {
  return frequency === ContributionFrequency.WEEKLY ? Math.round((durationMonths * 52) / 12) : durationMonths;
}

function computePeriodicRate(annualExpectedReturn: number, frequency: ContributionFrequency): number {
  const periodsPerYear = frequency === ContributionFrequency.WEEKLY ? 52 : 12;
  return annualExpectedReturn / periodsPerYear;
}

interface ContributionRow {
  periodIndex: number;
  amount: number;
  portfolioValue: number;
}

function computeContributions(
  contributionAmount: number,
  periodicRate: number,
  periods: number
): { contributions: ContributionRow[]; finalValue: number } {
  const contributions: ContributionRow[] = [];
  let balance = 0;
  for (let periodIndex = 0; periodIndex < periods; periodIndex++) {
    balance = (balance + contributionAmount) * (1 + periodicRate);
    contributions.push({ periodIndex, amount: contributionAmount, portfolioValue: round2(balance) });
  }
  return { contributions, finalValue: round2(balance) };
}

class SimulationService {
  async run(userId: string, input: unknown): Promise<RunSimulationResult> {
    const parsed = runSimulationSchema.parse(input);

    const template = await prisma.portfolioTemplate.findUnique({ where: { id: parsed.templateId } });
    if (!template) {
      throw new HttpError(404, "Portfolio template not found");
    }

    const periods = computePeriods(parsed.frequency, parsed.durationMonths);
    const periodicRate = computePeriodicRate(Number(template.expectedReturn), parsed.frequency);
    const { contributions, finalValue } = computeContributions(parsed.contributionAmount, periodicRate, periods);

    const simulation = await prisma.simulation.create({
      data: {
        userId,
        templateId: parsed.templateId,
        frequency: parsed.frequency,
        contributionAmount: parsed.contributionAmount,
        durationMonths: parsed.durationMonths,
        finalValue,
        contributions: { createMany: { data: contributions } },
      },
    });

    const totalContributed = round2(parsed.contributionAmount * periods);

    return {
      simulationId: simulation.id,
      finalValue,
      totalContributed,
      growth: round2(finalValue - totalContributed),
    };
  }

  async getHistory(_userId: string): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}

export const simulationService = new SimulationService();
