/**
 * PeerCohortService (DECISIONS.md #18): the default peer comparison. Loads the members
 * (everyone with a profile who has invested, real or simulated; see memberLoader.ts), hands
 * them to the cohort engine (utils/peerCohort.ts), and returns only aggregates: a cohort label,
 * a group description, medians and percentiles, never another person's record (NFR-03).
 *
 * Unlike the older peer views (peerInsights.service.ts), which aggregate in Postgres,
 * the nearest-neighbour step is computed here in application memory: it needs every
 * member's normalised features at once. That is cheap at this scale (hundreds of
 * members; a request reads one row per plan plus up to 12 months each) and is
 * documented as the point to move to a precomputed feature table if the population
 * ever grows by orders of magnitude.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { buildCohortReport, buildPopulation, CohortReport } from "../utils/peerCohort";
import { loadMembers } from "./memberLoader";
import { planService } from "./plan.service";

export type CohortResponse =
  | { status: "no-profile" | "no-plan" | "no-data" }
  | {
      status: "ok";
      /** The latest month the data runs to: the end of every comparison window. */
      asOf: string;
      population: { size: number; /** Percent of the population that is simulated. */ simulatedPct: number };
      report: CohortReport;
    };

class PeerCohortService {
  async getCohort(userId: string): Promise<CohortResponse> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) return { status: "no-profile" };

    // Recompute the user's own plan first, so their figures are as of the latest data month.
    const myPlan = await planService.getActivePlan(userId);
    if (!myPlan) return { status: "no-plan" };

    const data = await loadMembers();
    if (!data) return { status: "no-data" };

    const me = data.members.find((m) => m.id === userId);
    if (!me) return { status: "no-plan" };

    const report = buildCohortReport(buildPopulation(data.members), me, { asOf: data.asOf, fundReturns: data.fundReturns, minGroup: env.minGroupSize });
    return {
      status: "ok",
      asOf: data.asOf,
      population: { size: data.members.length, simulatedPct: Math.round((data.simulated / data.members.length) * 100) },
      report,
    };
  }
}

export const peerCohortService = new PeerCohortService();
