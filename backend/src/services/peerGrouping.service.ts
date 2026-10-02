/**
 * PeerGroupingService — DECISIONS.md #2 rewrite (25 Aug 2026). Replaces
 * the riskLevel+budgetBand+goalType 3-tier fallback entirely with an
 * income-range scheme, per explicit user direction: peers are users whose
 * UserProfile.monthlyIncome falls within ±10% of the requesting user's;
 * if fewer than MIN_GROUP_SIZE (env.minGroupSize, locked SRS §2.5 = 10)
 * match, widen to ±15%, ±20%, ±25%, ... (+5 percentage points per step)
 * until the threshold is met. The floor tier (mirroring the old
 * RISK_ONLY floor — returned even if still below threshold) is "everyone
 * with a profile and an active plan", once widening exceeds ±100%.
 *
 * A "member" is a User with a matching UserProfile who has an active Plan
 * with at least one PlanMonth (mirrors the old "ran ≥1 simulation with a
 * finalValue" bar) — peerBenchmark.service.ts's percentile population must
 * agree with this count, or memberCount would disagree with the N behind
 * the percentiles. Synthetic (isSynthetic) users are not filtered out
 * here — DECISIONS.md #4 has them participate in counts/percentiles, just
 * not exposed as individual records (NFR-03), which this service never
 * does.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

const STEP_START_PCT = 10; // ±10%
const STEP_INCREMENT_PCT = 5;
const STEP_CAP_PCT = 100; // beyond this, fall to the floor tier

export interface PeerGroupAssignment {
  bandPct: number | null; // null = floor tier ("everyone")
  lo: number;
  hi: number;
  memberCount: number;
}

function wideningStepsPct(): number[] {
  const steps: number[] = [];
  for (let pct = STEP_START_PCT; pct <= STEP_CAP_PCT; pct += STEP_INCREMENT_PCT) {
    steps.push(pct);
  }
  return steps;
}

async function countInRange(userId: string, lo: number, hi: number): Promise<number> {
  return prisma.userProfile.count({
    where: {
      userId: { not: userId },
      monthlyIncome: { gte: lo, lte: hi },
      user: { plan: { months: { some: {} } } },
    },
  });
}

async function countAll(userId: string): Promise<number> {
  return prisma.userProfile.count({
    where: {
      userId: { not: userId },
      user: { plan: { months: { some: {} } } },
    },
  });
}

class PeerGroupingService {
  async assignPeerGroup(userId: string): Promise<PeerGroupAssignment> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(404, "Set up your profile before comparing with peers");
    }
    const income = Number(profile.monthlyIncome);

    for (const pct of wideningStepsPct()) {
      const lo = income * (1 - pct / 100);
      const hi = income * (1 + pct / 100);
      const memberCount = await countInRange(userId, lo, hi);
      if (memberCount >= env.minGroupSize) {
        return { bandPct: pct, lo, hi, memberCount };
      }
    }

    // Floor tier — everyone with a profile and an active plan, returned
    // even if still below threshold since nothing broader is left.
    const memberCount = await countAll(userId);
    return { bandPct: null, lo: 0, hi: Infinity, memberCount };
  }
}

export const peerGroupingService = new PeerGroupingService();

// UC-05 step 6 transparency text — which band width the comparison
// actually used, since a wider band silently narrows how "peer" is
// defined and the user should know that.
export function describeTier(group: PeerGroupAssignment): string {
  if (group.bandPct === null) {
    return group.memberCount < env.minGroupSize
      ? `Only ${group.memberCount} peer${group.memberCount === 1 ? "" : "s"} with a profile so far — this comparison is based on a small sample and will get more reliable as more people join.`
      : "Not enough peers shared an income close to yours yet, so this compares you against everyone with a profile instead.";
  }
  if (group.bandPct === STEP_START_PCT) {
    return `Compared against peers earning within ${group.bandPct}% of your monthly income.`;
  }
  return `Not enough peers were within a tighter income range, so this compares you against peers earning within ${group.bandPct}% of your monthly income.`;
}
