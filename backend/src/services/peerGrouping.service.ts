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
import type { GoalType, RiskLevel } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

const STEP_START_PCT = 10; // ±10%
const STEP_INCREMENT_PCT = 5;
const STEP_CAP_PCT = 100; // beyond this, fall to the floor tier
const AGE_WINDOW_YEARS = 5; // "age" dimension: within ±5 years of the user

/** What "peers" can be matched on (DECISIONS.md #9). Only income widens. */
export type PeerDimension = "income" | "age" | "risk" | "goal" | "startMonth";
export const PEER_DIMENSIONS: readonly PeerDimension[] = ["income", "age", "risk", "goal", "startMonth"];

/** Parses the `dims` query value: absent = the default (income only); an
 * explicit empty string = no dimension (everyone); otherwise a comma list,
 * de-duplicated and validated against the known dimensions. */
export function parsePeerDimensions(raw: string | undefined): PeerDimension[] {
  if (raw === undefined) return ["income"];
  const parts = [...new Set(raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0))];
  for (const p of parts) {
    if (!(PEER_DIMENSIONS as readonly string[]).includes(p)) {
      throw new HttpError(400, `Unknown peer dimension "${p}". Use any of: ${PEER_DIMENSIONS.join(", ")}.`);
    }
  }
  return parts as PeerDimension[];
}

export interface PeerGroupFilters {
  age?: { lo: number; hi: number };
  riskLevel?: RiskLevel;
  goalType?: GoalType;
  startMonth?: Date;
}

export interface PeerGroupAssignment {
  bandPct: number | null; // null = no income restriction (floor tier / income not selected)
  lo: number;
  hi: number;
  memberCount: number;
  /** The dimensions the segment was matched on (default: income only). */
  dims?: PeerDimension[];
  /** The non-income filters applied, resolved from the user's own values. */
  filters?: PeerGroupFilters;
  /** True when an explicit selection matched fewer than MIN_GROUP_SIZE peers:
   * every statistic must then be withheld (memberCount is internal only). */
  suppressed?: boolean;
}

function wideningStepsPct(): number[] {
  const steps: number[] = [];
  for (let pct = STEP_START_PCT; pct <= STEP_CAP_PCT; pct += STEP_INCREMENT_PCT) {
    steps.push(pct);
  }
  return steps;
}

/** Counts peers — other users with a profile and an active plan — matching
 * the filters, optionally restricted to an income range. A "member" here
 * must agree with the population peerBenchmark/peerInsights aggregate over. */
async function countPeers(userId: string, filters: PeerGroupFilters, income?: { lo: number; hi: number }): Promise<number> {
  return prisma.userProfile.count({
    where: {
      userId: { not: userId },
      ...(income ? { monthlyIncome: { gte: income.lo, lte: income.hi } } : {}),
      ...(filters.age ? { age: { gte: filters.age.lo, lte: filters.age.hi } } : {}),
      ...(filters.riskLevel ? { riskLevel: filters.riskLevel } : {}),
      ...(filters.goalType ? { goalType: filters.goalType } : {}),
      user: { plan: { months: { some: {} }, ...(filters.startMonth ? { startMonth: filters.startMonth } : {}) } },
    },
  });
}

class PeerGroupingService {
  /** The default comparison: peers by income range only. Unchanged behaviour
   * — used by /peers/summary and the insight cards. */
  async assignPeerGroup(userId: string): Promise<PeerGroupAssignment> {
    return this.resolveSegment(userId, ["income"]);
  }

  /**
   * Resolves a user-chosen segment (DECISIONS.md #9). Each selected
   * dimension restricts peers to those matching the user's OWN value:
   * income within ±X% (the only dimension that widens, 10% → 100% in 5-point
   * steps until MIN_GROUP_SIZE is reached), age within ±5 years, same risk
   * level, same goal, same plan start month.
   *
   * Income-only is the default and keeps the original floor tier ("everyone",
   * returned even if small). Any richer selection that still falls short of
   * MIN_GROUP_SIZE is SUPPRESSED instead of silently widened — the user asked
   * for a specific group, and showing statistics over a handful of people
   * would break the minimum-group-size privacy rule.
   */
  async resolveSegment(userId: string, dims: PeerDimension[]): Promise<PeerGroupAssignment> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(404, "Set up your profile before comparing with peers");
    }

    const filters: PeerGroupFilters = {};
    if (dims.includes("age")) {
      filters.age = { lo: profile.age - AGE_WINDOW_YEARS, hi: profile.age + AGE_WINDOW_YEARS };
    }
    if (dims.includes("risk")) filters.riskLevel = profile.riskLevel;
    if (dims.includes("goal")) filters.goalType = profile.goalType;
    if (dims.includes("startMonth")) {
      const plan = await prisma.plan.findUnique({ where: { userId }, select: { startMonth: true } });
      if (!plan) throw new HttpError(400, "Start a plan before comparing by start month");
      filters.startMonth = plan.startMonth;
    }

    const incomeOnly = dims.length === 1 && dims[0] === "income";
    const base = { dims, filters };

    if (dims.includes("income")) {
      const income = Number(profile.monthlyIncome);
      for (const pct of wideningStepsPct()) {
        const lo = income * (1 - pct / 100);
        const hi = income * (1 + pct / 100);
        const memberCount = await countPeers(userId, filters, { lo, hi });
        if (memberCount >= env.minGroupSize) {
          return { ...base, bandPct: pct, lo, hi, memberCount, suppressed: false };
        }
      }
    }

    // No income restriction (income not selected, or widening was exhausted).
    const memberCount = await countPeers(userId, filters);
    const unrestricted = { ...base, bandPct: null, lo: 0, hi: Infinity, memberCount };

    // Original floor tier: the default income-only view always shows
    // *something*, flagged as a small sample if need be.
    if (incomeOnly) return { ...unrestricted, suppressed: false };

    return { ...unrestricted, suppressed: memberCount < env.minGroupSize };
  }
}

export const peerGroupingService = new PeerGroupingService();

/** Transparency text for a chosen segment (DECISIONS.md #9): says exactly
 * what "peers" meant, including any widening, so the numbers can be read
 * correctly. Never states an exact count when the segment is suppressed. */
export function describeSegment(group: PeerGroupAssignment): string {
  if (group.suppressed) {
    return `Fewer than ${env.minGroupSize} peers match this selection, so no statistics are shown. Try removing a filter.`;
  }

  const dims = group.dims ?? ["income"];
  const parts: string[] = [];
  if (dims.includes("income") && group.bandPct !== null) parts.push(`earning within ${group.bandPct}% of your monthly income`);
  if (group.filters?.age) parts.push(`aged ${group.filters.age.lo}–${group.filters.age.hi}`);
  if (group.filters?.riskLevel) parts.push("with your risk level");
  if (group.filters?.goalType) parts.push("with your goal");
  if (group.filters?.startMonth) parts.push("who started in the same month as you");

  let text = parts.length > 0 ? `Compared against peers ${parts.join(", ")}.` : "Compared against all peers.";

  if (dims.includes("income")) {
    if (group.bandPct === null) {
      text += " Too few peers had a similar income, so income wasn't used to narrow this group.";
    } else if (group.bandPct > STEP_START_PCT) {
      text += ` The income range was widened to ±${group.bandPct}% to reach enough peers.`;
    }
  }
  return text;
}

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
