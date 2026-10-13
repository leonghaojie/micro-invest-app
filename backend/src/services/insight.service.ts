/**
 * InsightService — FR12 (UC-06), rebuilt on the cohort engine (DECISIONS.md #32, 13 Oct 2026).
 * Loads the members the Peers tab uses (memberLoader.ts) and hands them to the pure card
 * builder (utils/insightCards.ts). Returns aggregates only: medians, quartiles and the user's
 * own position, never another person's record (NFR-03).
 *
 * The cards replace the old income-band cards. They describe and never advise: there is no
 * suggested contribution and no "Adjust Plan" action any more.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { buildInsightCards, InsightCard } from "../utils/insightCards";
import { buildPopulation } from "../utils/peerCohort";
import { loadMembers } from "./memberLoader";
import { planService } from "./plan.service";

export type InsightsResponse =
  | { status: "no-profile" | "no-plan" | "no-data" }
  | {
      status: "ok";
      /** The month-end the figures are as of, "YYYY-MM". */
      asOf: string;
      /** Percent of the comparison population that is simulated. */
      simulatedPct: number;
      cards: InsightCard[];
    };

class InsightService {
  async generate(userId: string): Promise<InsightsResponse> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) return { status: "no-profile" };

    // Bring the user's own account up to the latest data month before comparing.
    const myPlan = await planService.getActivePlan(userId);
    if (!myPlan) return { status: "no-plan" };

    const data = await loadMembers();
    if (!data) return { status: "no-data" };

    // Not a member until they have invested: nothing to compare yet.
    const me = data.members.find((m) => m.id === userId);
    if (!me) return { status: "no-plan" };

    return {
      status: "ok",
      asOf: data.asOf,
      simulatedPct: Math.round((data.simulated / data.members.length) * 100),
      cards: buildInsightCards(buildPopulation(data.members), me, { minGroup: env.minGroupSize }),
    };
  }
}

export const insightService = new InsightService();
