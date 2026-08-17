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
 * ⚠️ PLACEHOLDER thresholds — the SRS Data Dictionary defines the real
 * B1–B4 cutoffs and this repo doesn't carry a copy of it. Round-number
 * quartile split chosen so the pipeline (UI → derivation → peer grouping)
 * is exercisable end-to-end; swap these for the SRS-locked values before
 * Phase 5 peer grouping depends on band correctness.
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
