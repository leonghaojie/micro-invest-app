/**
 * PeerBenchmarkService — FR10, FR11 (Design Model §5.3).
 *
 * Pushes percentile computation into PostgreSQL via prisma.$queryRaw —
 * the one place in the codebase where raw SQL is intentional (Design Model
 * §3.1), since PERCENTILE_CONT/PERCENTILE_DISC are not exposed through
 * Prisma's query builder. NFR-03: only ever returns aggregated stats, never
 * raw peer records.
 *
 * Each member's value data point is their *latest* Simulation's finalValue
 * (DISTINCT ON, mirroring dashboard.service.ts's "latest run" convention),
 * not every simulation they've ever run — otherwise a user who ran 20
 * simulations would outweigh one who ran 1.
 *
 * medianConsistency: each member's own ConsistencyScore (SRS v1.1 §4 Data
 * Dictionary formula) is computed via dashboard.service.ts's shared
 * computeConsistencyScore — the same function getBehaviour() uses for the
 * requesting user — over *all* of their simulations (unlike the value
 * percentiles above, ConsistencyScore is inherently a full-history metric,
 * not a latest-run one). The median of those per-member scores is then
 * taken in application code rather than in SQL: with member counts this
 * small there's no performance case for pushing a second aggregation into
 * Postgres, and it avoids reimplementing the month-bucketing logic a
 * second time in raw SQL where it could silently drift from the one
 * dashboard.service.ts already has right.
 *
 * Results are cached into peer_groups/peer_group_stats (find-or-create the
 * group row, upsert its stats) since the schema clearly anticipates that,
 * but always recomputed fresh on every call — no staleness/TTL policy is
 * documented anywhere to justify serving a stale cached read instead.
 */
import { prisma } from "../config/prisma";
import { computeConsistencyScore } from "./dashboard.service";
import type { PeerGroupAssignment } from "./peerGrouping.service";
import { round2 } from "./simulation.service";

export interface PeerGroupStats {
  p25: number;
  p50: number;
  p75: number;
  memberCount: number;
  medianConsistency: number;
}

interface RawValueStatsRow {
  p25: string | null;
  p50: string | null;
  p75: string | null;
  memberCount: number;
}

interface MemberActivityRow {
  userId: string;
  createdAt: Date;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round2((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

class PeerBenchmarkService {
  async computePeerGroupStats(group: PeerGroupAssignment): Promise<PeerGroupStats> {
    const [valueRows, activityRows] = await Promise.all([
      prisma.$queryRaw<RawValueStatsRow[]>`
        WITH latest_sim AS (
          SELECT DISTINCT ON (s."userId") s."userId", s."finalValue"
          FROM simulations s
          JOIN user_profiles up ON up."userId" = s."userId"
          WHERE up."riskLevel" = ${group.riskLevel}::"RiskLevel"
            AND (${group.budgetBand}::"BudgetBand" IS NULL OR up."budgetBand" = ${group.budgetBand}::"BudgetBand")
            AND (${group.goalType}::"GoalType" IS NULL OR up."goalType" = ${group.goalType}::"GoalType")
            AND s."finalValue" IS NOT NULL
          ORDER BY s."userId", s."createdAt" DESC
        )
        SELECT
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "finalValue") AS p25,
          PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "finalValue") AS p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "finalValue") AS p75,
          COUNT(*)::int AS "memberCount"
        FROM latest_sim;
      `,
      prisma.$queryRaw<MemberActivityRow[]>`
        SELECT s."userId" AS "userId", s."createdAt" AS "createdAt"
        FROM simulations s
        JOIN user_profiles up ON up."userId" = s."userId"
        WHERE up."riskLevel" = ${group.riskLevel}::"RiskLevel"
          AND (${group.budgetBand}::"BudgetBand" IS NULL OR up."budgetBand" = ${group.budgetBand}::"BudgetBand")
          AND (${group.goalType}::"GoalType" IS NULL OR up."goalType" = ${group.goalType}::"GoalType")
          AND s."finalValue" IS NOT NULL;
      `,
    ]);

    const row = valueRows[0];
    const byMember = new Map<string, Date[]>();
    for (const r of activityRows) {
      const dates = byMember.get(r.userId) ?? [];
      dates.push(r.createdAt);
      byMember.set(r.userId, dates);
    }
    const memberConsistencyScores = [...byMember.values()].map((dates) => computeConsistencyScore(dates).consistencyScore);

    const stats: PeerGroupStats = {
      p25: row?.p25 !== null && row?.p25 !== undefined ? Number(row.p25) : 0,
      p50: row?.p50 !== null && row?.p50 !== undefined ? Number(row.p50) : 0,
      p75: row?.p75 !== null && row?.p75 !== undefined ? Number(row.p75) : 0,
      memberCount: row?.memberCount ?? 0,
      medianConsistency: median(memberConsistencyScores),
    };

    await this.cacheStats(group, stats);
    return stats;
  }

  // The requesting user's own comparison point — their latest simulation's
  // finalValue, same "latest run" convention as the group query above.
  // Null if they haven't run one yet; the summary endpoint still returns
  // group stats in that case, just without a personal value to plot.
  async getLatestFinalValue(userId: string): Promise<number | null> {
    const latest = await prisma.simulation.findFirst({
      where: { userId, finalValue: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { finalValue: true },
    });
    return latest?.finalValue != null ? Number(latest.finalValue) : null;
  }

  private async cacheStats(group: PeerGroupAssignment, stats: PeerGroupStats): Promise<void> {
    const peerGroup =
      (await prisma.peerGroup.findFirst({
        where: { riskLevel: group.riskLevel, budgetBand: group.budgetBand, goalType: group.goalType, tier: group.tier },
      })) ??
      (await prisma.peerGroup.create({
        data: { riskLevel: group.riskLevel, budgetBand: group.budgetBand, goalType: group.goalType, tier: group.tier },
      }));

    await prisma.peerGroupStats.upsert({
      where: { peerGroupId: peerGroup.id },
      create: {
        peerGroupId: peerGroup.id,
        medianValue: stats.p50,
        p25: stats.p25,
        p50: stats.p50,
        p75: stats.p75,
        medianConsistency: stats.medianConsistency,
        memberCount: stats.memberCount,
      },
      update: {
        medianValue: stats.p50,
        p25: stats.p25,
        p50: stats.p50,
        p75: stats.p75,
        medianConsistency: stats.medianConsistency,
        memberCount: stats.memberCount,
        lastComputedAt: new Date(),
      },
    });
  }
}

export const peerBenchmarkService = new PeerBenchmarkService();
