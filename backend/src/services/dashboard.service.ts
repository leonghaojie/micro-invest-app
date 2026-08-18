/**
 * DashboardService — FR08. NFR-01: dashboard responses must support <2s load.
 *
 * All three endpoints key off the user's own Simulation history — there's
 * no persistent "portfolio" beyond individual simulation runs (each run is
 * an independent what-if scenario, per simulation.service.ts), so "summary"
 * and "growth" both report on the most recent run rather than inventing a
 * cross-run aggregate that wouldn't correspond to anything real.
 */
import { prisma } from "../config/prisma";
import { computePeriods, round2 } from "./simulation.service";

export interface DashboardSummary {
  hasSimulations: boolean;
  totalSimulations: number;
  latestSimulation: {
    simulationId: string;
    templateName: string;
    finalValue: number;
    totalContributed: number;
    growth: number;
    createdAt: string;
  } | null;
}

export interface GrowthPoint {
  periodIndex: number;
  portfolioValue: number;
}

export interface DashboardGrowth {
  simulationId: string | null;
  templateName: string | null;
  points: GrowthPoint[];
}

export interface DashboardBehaviour {
  consistencyScore: number;
  monthsWithActivity: number;
  monthsSinceFirstRun: number;
}

// year*12 + zero-based month, in UTC so this doesn't drift with server TZ
// (NFR-04 reproducibility, same spirit as the deterministic sim engine).
function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

// Exported so peerBenchmark.service.ts can compute each peer group
// member's own ConsistencyScore with the identical formula, rather than
// re-deriving the same month-bucketing logic a second time (in raw SQL, no
// less) — SRS v1.1 §4 Data Dictionary defines exactly one ConsistencyScore
// formula, so there must be exactly one implementation of it.
export function computeConsistencyScore(simulationDates: Date[], now: Date = new Date()): DashboardBehaviour {
  if (simulationDates.length === 0) {
    return { consistencyScore: 0, monthsWithActivity: 0, monthsSinceFirstRun: 0 };
  }

  const monthIndexes = simulationDates.map(monthIndex);
  const monthsWithActivity = new Set(monthIndexes).size;

  const firstRunMonth = Math.min(...monthIndexes);
  const currentMonth = monthIndex(now);
  const monthsSinceFirstRun = currentMonth - firstRunMonth + 1;

  return {
    consistencyScore: round2((monthsWithActivity / monthsSinceFirstRun) * 100),
    monthsWithActivity,
    monthsSinceFirstRun,
  };
}

class DashboardService {
  async getSummary(userId: string): Promise<DashboardSummary> {
    const [totalSimulations, latest] = await Promise.all([
      prisma.simulation.count({ where: { userId } }),
      prisma.simulation.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { template: true },
      }),
    ]);

    if (!latest) {
      return { hasSimulations: false, totalSimulations: 0, latestSimulation: null };
    }

    const periods = computePeriods(latest.frequency, latest.durationMonths);
    const totalContributed = round2(Number(latest.contributionAmount) * periods);
    const finalValue = Number(latest.finalValue ?? 0);

    return {
      hasSimulations: true,
      totalSimulations,
      latestSimulation: {
        simulationId: latest.id,
        templateName: latest.template.name,
        finalValue,
        totalContributed,
        growth: round2(finalValue - totalContributed),
        createdAt: latest.createdAt.toISOString(),
      },
    };
  }

  async getGrowth(userId: string): Promise<DashboardGrowth> {
    const latest = await prisma.simulation.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        template: true,
        contributions: { orderBy: { periodIndex: "asc" } },
      },
    });

    if (!latest) {
      return { simulationId: null, templateName: null, points: [] };
    }

    return {
      simulationId: latest.id,
      templateName: latest.template.name,
      points: latest.contributions.map((c) => ({
        periodIndex: c.periodIndex,
        portfolioValue: Number(c.portfolioValue),
      })),
    };
  }

  async getBehaviour(userId: string): Promise<DashboardBehaviour> {
    // DECISIONS.md #3 (SRS v1.2 §4 Data Dictionary):
    //   ConsistencyScore = (months with >=1 Simulation run) /
    //     (months since first Simulation run) * 100
    // Cold-start (one run, this month) -> 1/1 * 100 = 100.
    const simulations = await prisma.simulation.findMany({
      where: { userId },
      select: { createdAt: true },
    });

    return computeConsistencyScore(simulations.map((s) => s.createdAt));
  }
}

export const dashboardService = new DashboardService();
