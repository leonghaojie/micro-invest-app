/**
 * PeerBenchmarkService — FR10, FR11, rewritten for DECISIONS.md #2's
 * income-range peer grouping (25 Aug 2026). No more PeerGroup/
 * PeerGroupStats cache tables — a continuous income range isn't a small
 * enumerable/cacheable key the way the old risk/budget/goal tiers were,
 * and this service already documented "always recomputed fresh... no
 * staleness policy" as its rationale before, so dropping the cache table
 * is consistent, not a regression.
 *
 * Still pushes percentile computation into Postgres via prisma.$queryRaw
 * (PERCENTILE_CONT isn't exposed through Prisma's query builder) — NFR-03:
 * only ever returns aggregated stats, never raw peer records.
 *
 * Three metrics, same peer population (income-range members with an
 * active plan), all computed in one query:
 *  - portfolio value — latest PlanMonth.endingBalance per member
 *  - Savings Rate % — (monthlyIncome - monthlyExpense) / monthlyIncome * 100
 *  - Emergency Buffer — latest PlanMonth.walletBalance / monthlyExpense
 */
import { prisma } from "../config/prisma";
import type { PeerGroupAssignment } from "./peerGrouping.service";

export interface PercentileStats {
  p25: number;
  p50: number;
  p75: number;
}

export interface PeerBenchmarkStats {
  memberCount: number;
  value: PercentileStats;
  savingsRatePct: PercentileStats;
  emergencyBuffer: PercentileStats;
}

export interface MyMetrics {
  finalValue: number | null;
  savingsRatePct: number;
  emergencyBuffer: number | null;
}

interface RawStatsRow {
  memberCount: number;
  valueP25: string | null;
  valueP50: string | null;
  valueP75: string | null;
  savingsP25: string | null;
  savingsP50: string | null;
  savingsP75: string | null;
  bufferP25: string | null;
  bufferP50: string | null;
  bufferP75: string | null;
}

function toStats(row: RawStatsRow | undefined): PeerBenchmarkStats {
  const num = (v: string | null | undefined) => (v !== null && v !== undefined ? Number(v) : 0);
  return {
    memberCount: row?.memberCount ?? 0,
    value: { p25: num(row?.valueP25), p50: num(row?.valueP50), p75: num(row?.valueP75) },
    savingsRatePct: { p25: num(row?.savingsP25), p50: num(row?.savingsP50), p75: num(row?.savingsP75) },
    emergencyBuffer: { p25: num(row?.bufferP25), p50: num(row?.bufferP50), p75: num(row?.bufferP75) },
  };
}

class PeerBenchmarkService {
  async computeStats(userId: string, group: PeerGroupAssignment): Promise<PeerBenchmarkStats> {
    const rows =
      group.bandPct === null
        ? await prisma.$queryRaw<RawStatsRow[]>`
            WITH latest_month AS (
              SELECT DISTINCT ON (p."userId") p."userId" AS "userId", pm."endingBalance", pm."walletBalance"
              FROM plans p
              JOIN plan_months pm ON pm."planId" = p.id
              WHERE p.id IN (SELECT "planId" FROM plan_months WHERE "hasPosition")
              ORDER BY p."userId", pm."monthDate" DESC
            ),
            peers AS (
              SELECT up."monthlyIncome", up."monthlyExpense", lm."endingBalance", lm."walletBalance"
              FROM user_profiles up
              JOIN latest_month lm ON lm."userId" = up."userId"
              WHERE up."userId" != ${userId}
            )
            SELECT
              COUNT(*)::int AS "memberCount",
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "endingBalance") AS "valueP25",
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "endingBalance") AS "valueP50",
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "endingBalance") AS "valueP75",
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY (("monthlyIncome" - "monthlyExpense") / "monthlyIncome" * 100)) AS "savingsP25",
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY (("monthlyIncome" - "monthlyExpense") / "monthlyIncome" * 100)) AS "savingsP50",
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (("monthlyIncome" - "monthlyExpense") / "monthlyIncome" * 100)) AS "savingsP75",
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ("walletBalance" / NULLIF("monthlyExpense", 0))) AS "bufferP25",
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY ("walletBalance" / NULLIF("monthlyExpense", 0))) AS "bufferP50",
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ("walletBalance" / NULLIF("monthlyExpense", 0))) AS "bufferP75"
            FROM peers;
          `
        : await prisma.$queryRaw<RawStatsRow[]>`
            WITH latest_month AS (
              SELECT DISTINCT ON (p."userId") p."userId" AS "userId", pm."endingBalance", pm."walletBalance"
              FROM plans p
              JOIN plan_months pm ON pm."planId" = p.id
              WHERE p.id IN (SELECT "planId" FROM plan_months WHERE "hasPosition")
              ORDER BY p."userId", pm."monthDate" DESC
            ),
            peers AS (
              SELECT up."monthlyIncome", up."monthlyExpense", lm."endingBalance", lm."walletBalance"
              FROM user_profiles up
              JOIN latest_month lm ON lm."userId" = up."userId"
              WHERE up."userId" != ${userId}
                AND up."monthlyIncome" BETWEEN ${group.lo} AND ${group.hi}
            )
            SELECT
              COUNT(*)::int AS "memberCount",
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "endingBalance") AS "valueP25",
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "endingBalance") AS "valueP50",
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "endingBalance") AS "valueP75",
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY (("monthlyIncome" - "monthlyExpense") / "monthlyIncome" * 100)) AS "savingsP25",
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY (("monthlyIncome" - "monthlyExpense") / "monthlyIncome" * 100)) AS "savingsP50",
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (("monthlyIncome" - "monthlyExpense") / "monthlyIncome" * 100)) AS "savingsP75",
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ("walletBalance" / NULLIF("monthlyExpense", 0))) AS "bufferP25",
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY ("walletBalance" / NULLIF("monthlyExpense", 0))) AS "bufferP50",
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ("walletBalance" / NULLIF("monthlyExpense", 0))) AS "bufferP75"
            FROM peers;
          `;

    return toStats(rows[0]);
  }

  // The requesting user's own comparison point across all three metrics.
  async getMyMetrics(userId: string): Promise<MyMetrics> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      return { finalValue: null, savingsRatePct: 0, emergencyBuffer: null };
    }
    const income = Number(profile.monthlyIncome);
    const expense = Number(profile.monthlyExpense);
    const savingsRatePct = income > 0 ? Math.round(((income - expense) / income) * 100 * 100) / 100 : 0;

    const latestMonth = await prisma.planMonth.findFirst({
      where: { plan: { userId } },
      orderBy: { monthDate: "desc" },
    });

    // Cash alone is not an investment: no value to compare until something has been bought.
    const invested = latestMonth ? await prisma.planMonth.count({ where: { plan: { userId }, hasPosition: true } }) : 0;
    if (!latestMonth) {
      return { finalValue: null, savingsRatePct, emergencyBuffer: null };
    }

    return {
      finalValue: invested > 0 ? Number(latestMonth.endingBalance) : null,
      savingsRatePct,
      emergencyBuffer: expense > 0 ? Number(latestMonth.walletBalance) / expense : null,
    };
  }
}

export const peerBenchmarkService = new PeerBenchmarkService();
