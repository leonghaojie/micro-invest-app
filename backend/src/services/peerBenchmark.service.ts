/**
 * PeerBenchmarkService — FR10, FR11 (Design Model §5.3).
 *
 * Pushes percentile computation into PostgreSQL via prisma.$queryRaw —
 * the one place in the codebase where raw SQL is intentional (Design Model
 * §3.1), since PERCENTILE_CONT/PERCENTILE_DISC are not exposed through
 * Prisma's query builder. NFR-03: only ever returns aggregated stats, never
 * raw peer records.
 *
 * Implementation lands in Phase 5.
 */
import { prisma } from "../config/prisma";
import type { PeerGroupAssignment } from "./peerGrouping.service";

export interface PeerGroupStats {
  p25: number;
  p50: number;
  p75: number;
  memberCount: number;
}

class PeerBenchmarkService {
  async computePeerGroupStats(
    _group: PeerGroupAssignment | { implemented: false }
  ): Promise<{ implemented: false }> {
    // TODO Phase 5 — issue via prisma.$queryRaw (Design Model §5.3):
    //
    // SELECT
    //   PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "finalValue") AS p25,
    //   PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "finalValue") AS p50,
    //   PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "finalValue") AS p75,
    //   COUNT(*) AS "memberCount"
    // FROM simulations s
    // JOIN user_profiles up ON up."userId" = s."userId"
    // WHERE up."riskLevel" = $1
    //   AND ($2::text IS NULL OR up."budgetBand" = $2)
    //   AND ($3::text IS NULL OR up."goalType" = $3);
    void prisma;
    return { implemented: false };
  }
}

export const peerBenchmarkService = new PeerBenchmarkService();
