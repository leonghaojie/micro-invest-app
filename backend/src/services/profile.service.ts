/**
 * ProfileService — FR03. Budget band (B1–B4) derivation from raw monthly
 * budget input happens server-side here (Design Model §4.2, user_profiles).
 */
import { BudgetBand, GoalType, RiskLevel } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

const upsertProfileSchema = z.object({
  riskLevel: z.nativeEnum(RiskLevel),
  goalType: z.nativeEnum(GoalType),
  monthlyBudget: z.number().positive("Monthly budget must be greater than 0"),
});

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;

export interface ProfileResult {
  riskLevel: RiskLevel;
  goalType: GoalType;
  budgetBand: BudgetBand;
}

/**
 * ⚠️ PLACEHOLDER thresholds — checked against every version of the actual
 * SRS/Design Model docs (Phase0_SRS_UseCase_Model_v1.0, Phase1_SRS_v1.1,
 * Phase1_Analysis_Model_v1.0, Phase2_Design_Model_v1.0): all of them say
 * "System maps the budget to a budget band (B1–B4)" without ever locking
 * exact dollar cutoffs. Unlike TBD-01/02/04 (simulation model, peer-group
 * fallback, ConsistencyScore), which v1.1 explicitly resolves, this one
 * was never assigned a TBD number and never closed — it's a genuine gap
 * in the requirements, not something this repo is just missing a copy of.
 * Round-number quartile split chosen so the pipeline (UI → derivation →
 * peer grouping) is exercisable end-to-end; swap these for real values
 * once the SRS actually defines them — peer grouping (FULL/RISK_BUDGET
 * tiers) keys off this band, so getting it wrong silently misgroups
 * users rather than erroring.
 */
function deriveBudgetBand(monthlyBudget: number): BudgetBand {
  if (monthlyBudget < 50) return BudgetBand.B1;
  if (monthlyBudget < 150) return BudgetBand.B2;
  if (monthlyBudget < 400) return BudgetBand.B3;
  return BudgetBand.B4;
}

class ProfileService {
  async getProfile(userId: string): Promise<ProfileResult> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(404, "Profile not set up yet");
    }
    return { riskLevel: profile.riskLevel, goalType: profile.goalType, budgetBand: profile.budgetBand };
  }

  async upsertProfile(userId: string, input: unknown): Promise<ProfileResult> {
    const { riskLevel, goalType, monthlyBudget } = upsertProfileSchema.parse(input);
    const budgetBand = deriveBudgetBand(monthlyBudget);

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, riskLevel, goalType, budgetBand },
      update: { riskLevel, goalType, budgetBand },
    });

    return { riskLevel: profile.riskLevel, goalType: profile.goalType, budgetBand: profile.budgetBand };
  }
}

export const profileService = new ProfileService();
