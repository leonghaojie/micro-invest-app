/**
 * PeerGroupingService «strategy» (Design Model §3, §5.1–§5.2).
 *
 * Walks a fixed sequence of matching strategies (FULL → RISK_BUDGET →
 * RISK_ONLY) and returns the first tier whose member count reaches
 * MIN_GROUP_SIZE (locked SRS §2.5, = 10) — the Strategy pattern applied to
 * a fallback chain. RISK_ONLY is the floor tier: it is returned even if
 * still below threshold, since nothing broader is left to fall back to
 * (UC-05 exception).
 *
 * This is the Lab #4 basis-path testing target (roadmap.md, Phase 5) — the
 * three branches below are written to be independently exercisable in a
 * test, so keep them as separate `if` returns rather than collapsing them.
 *
 * Implementation lands in Phase 5.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";

export type PeerGroupTier = "FULL" | "RISK_BUDGET" | "RISK_ONLY";

export interface PeerGroupAssignment {
  tier: PeerGroupTier;
  riskLevel: string;
  budgetBand: string | null;
  goalType: string | null;
}

class PeerGroupingService {
  async assignPeerGroup(_userId: string): Promise<{ implemented: false }> {
    void env.minGroupSize; // MIN_GROUP_SIZE, read here once implemented
    void prisma;

    // TODO Phase 5 — implement the fallback walk from Design Model §5.2:
    //   countFull = count(riskLevel, budgetBand, goalType)
    //   if countFull >= MIN_GROUP_SIZE: return { tier: FULL, ... }
    //   countRiskBudget = count(riskLevel, budgetBand, null)
    //   if countRiskBudget >= MIN_GROUP_SIZE: return { tier: RISK_BUDGET, ... }
    //   countRiskOnly = count(riskLevel, null, null)
    //   return { tier: RISK_ONLY, ... }  // floor tier
    return { implemented: false };
  }
}

export const peerGroupingService = new PeerGroupingService();
