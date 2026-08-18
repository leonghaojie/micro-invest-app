/**
 * PeerBenchmarkService — FR10, FR11 (Design Model §5.3).
 *
 * Pushes percentile computation into PostgreSQL via prisma.$queryRaw —
 * the one place in the codebase where raw SQL is intentional (Design Model
 * §3.1), since PERCENTILE_CONT/PERCENTILE_DISC are not exposed through
 * Prisma's query builder. NFR-03: only ever returns aggregated stats, never
 * raw peer records.
 *
 * Each member's data point is their *latest* Simulation's finalValue
 * (DISTINCT ON, mirroring dashboard.service.ts's "latest run" convention),
 * not every simulation they've ever run — otherwise a user who ran 20
 * simulations would outweigh one who ran 1.
 *
 * Results are cached into peer_groups/peer_group_stats (find-or-create the
 * group row, upsert its stats) since the schema clearly anticipates that,
 * but always recomputed fresh on every call — no staleness/TTL policy is
 * documented anywhere to justify serving a stale cached read instead.
 * medianConsistency is deliberately left untouched: DECISIONS.md #3 flags
 * it as a separate, still-open item, not part of this query.
 */
import { prisma } from "../config/prisma";
import type { PeerGroupAssignment } from "./peerGrouping.service";

export interface PeerGroupStats {
  p25: number;
  p50: number;
  p75: number;
  memberCount: number;
}

interface RawStatsRow {
  p25: string | null;
  p50: string | null;
  p75: string | null;
  memberCount: number;
}

class PeerBenchmarkService {
  async computePeerGroupStats(group: PeerGroupAssignment): Promise<PeerGroupStats> {
    const rows = await prisma.$queryRaw<RawStatsRow[]>`
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
    `;

    const row = rows[0];
    const stats: PeerGroupStats = {
      p25: row?.p25 !== null && row?.p25 !== undefined ? Number(row.p25) : 0,
      p50: row?.p50 !== null && row?.p50 !== undefined ? Number(row.p50) : 0,
      p75: row?.p75 !== null && row?.p75 !== undefined ? Number(row.p75) : 0,
      memberCount: row?.memberCount ?? 0,
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
        memberCount: stats.memberCount,
      },
      update: {
        medianValue: stats.p50,
        p25: stats.p25,
        p50: stats.p50,
        p75: stats.p75,
        memberCount: stats.memberCount,
        lastComputedAt: new Date(),
      },
    });
  }
}

export const peerBenchmarkService = new PeerBenchmarkService();
