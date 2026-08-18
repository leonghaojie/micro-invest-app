/**
 * PeerGroupingService «strategy» (Design Model §3, §5.1–§5.2).
 *
 * Walks a fixed sequence of matching strategies (FULL → RISK_BUDGET →
 * RISK_ONLY) and returns the first tier whose member count reaches
 * MIN_GROUP_SIZE (locked SRS §2.5, = 10) — the Strategy pattern applied to
 * a fallback chain. RISK_ONLY is the floor tier: it is returned even if
 * still below threshold, since nothing broader is left to fall back to
 * (UC-05 exception, DECISIONS.md #2).
 *
 * This is the Lab #4 basis-path testing target (roadmap.md, Phase 5) — the
 * three branches below are written to be independently exercisable in a
 * test, so kept as separate `if` returns rather than collapsed.
 *
 * A "member" for both the threshold count here and PeerBenchmarkService's
 * percentile computation is a User with a matching UserProfile who has run
 * at least one Simulation with a finalValue — the two must agree on the
 * same population, or memberCount would disagree with the N behind the
 * percentiles. Synthetic (isSynthetic) users are not filtered out here:
 * DECISIONS.md #4 has them participate in counts/percentiles, just not
 * exposed as individual records (NFR-03) — which this service never does.
 */
import { BudgetBand, GoalType, RiskLevel } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

export type PeerGroupTier = "FULL" | "RISK_BUDGET" | "RISK_ONLY";

export interface PeerGroupAssignment {
  tier: PeerGroupTier;
  riskLevel: RiskLevel;
  budgetBand: BudgetBand | null;
  goalType: GoalType | null;
}

async function countMembers(
  riskLevel: RiskLevel,
  budgetBand: BudgetBand | null,
  goalType: GoalType | null
): Promise<number> {
  return prisma.userProfile.count({
    where: {
      riskLevel,
      ...(budgetBand ? { budgetBand } : {}),
      ...(goalType ? { goalType } : {}),
      user: { simulations: { some: { finalValue: { not: null } } } },
    },
  });
}

class PeerGroupingService {
  async assignPeerGroup(userId: string): Promise<PeerGroupAssignment> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(404, "Set up your profile before comparing with peers");
    }
    const { riskLevel, budgetBand, goalType } = profile;

    const countFull = await countMembers(riskLevel, budgetBand, goalType);
    if (countFull >= env.minGroupSize) {
      return { tier: "FULL", riskLevel, budgetBand, goalType };
    }

    const countRiskBudget = await countMembers(riskLevel, budgetBand, null);
    if (countRiskBudget >= env.minGroupSize) {
      return { tier: "RISK_BUDGET", riskLevel, budgetBand, goalType: null };
    }

    // Floor tier — returned even if still below MIN_GROUP_SIZE.
    return { tier: "RISK_ONLY", riskLevel, budgetBand: null, goalType: null };
  }
}

export const peerGroupingService = new PeerGroupingService();

// UC-05 step 6 transparency text — which fallback tier the comparison
// actually used, since RISK_BUDGET/RISK_ONLY silently narrow how "peer"
// is defined and the user should know that.
export function describeTier(tier: PeerGroupTier, memberCount: number): string {
  switch (tier) {
    case "FULL":
      return "Compared against peers with the same risk level, budget, and goal.";
    case "RISK_BUDGET":
      return "Not enough peers shared your exact goal yet, so this compares you against peers with the same risk level and budget instead.";
    case "RISK_ONLY":
      return memberCount < env.minGroupSize
        ? `Only ${memberCount} peer${memberCount === 1 ? "" : "s"} with your risk level so far — this comparison is based on a small sample and will get more reliable as more people join.`
        : "Not enough peers shared your budget yet, so this compares you against all peers with the same risk level instead.";
  }
}
