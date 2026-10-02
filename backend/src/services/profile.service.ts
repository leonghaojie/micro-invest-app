/**
 * ProfileService — FR03. DECISIONS.md #1 third amendment / #2 rewrite (25
 * Aug 2026): the profile now carries monthlyIncome/monthlyExpense/age
 * instead of a monthlyBudget -> budgetBand derivation. riskLevel/goalType
 * are kept (unused for grouping now — see peerGrouping.service.ts) since
 * the user explicitly asked to keep them on the profile.
 *
 * Also exposes Savings Rate here (DECISIONS.md new metrics entry) since
 * it's a pure profile-level figure — (monthlyIncome - monthlyExpense) /
 * monthlyIncome — needing no Plan.
 */
import { GoalType, RiskLevel } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { round2 } from "./plan.service";

const upsertProfileSchema = z.object({
  riskLevel: z.nativeEnum(RiskLevel),
  goalType: z.nativeEnum(GoalType),
  monthlyIncome: z.number().positive("Monthly income must be greater than 0"),
  monthlyExpense: z.number().nonnegative("Monthly expense cannot be negative"),
  age: z.number().int().min(13, "Age must be at least 13").max(120, "Enter a realistic age"),
});

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;

export interface ProfileResult {
  riskLevel: RiskLevel;
  goalType: GoalType;
  monthlyIncome: number;
  monthlyExpense: number;
  age: number;
  savingsRatePct: number;
}

function computeSavingsRatePct(monthlyIncome: number, monthlyExpense: number): number {
  if (monthlyIncome <= 0) return 0;
  return round2(((monthlyIncome - monthlyExpense) / monthlyIncome) * 100);
}

function toResult(profile: { riskLevel: RiskLevel; goalType: GoalType; monthlyIncome: unknown; monthlyExpense: unknown; age: number }): ProfileResult {
  const monthlyIncome = Number(profile.monthlyIncome);
  const monthlyExpense = Number(profile.monthlyExpense);
  return {
    riskLevel: profile.riskLevel,
    goalType: profile.goalType,
    monthlyIncome,
    monthlyExpense,
    age: profile.age,
    savingsRatePct: computeSavingsRatePct(monthlyIncome, monthlyExpense),
  };
}

class ProfileService {
  async getProfile(userId: string): Promise<ProfileResult> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(404, "Profile not set up yet");
    }
    return toResult(profile);
  }

  async upsertProfile(userId: string, input: unknown): Promise<ProfileResult> {
    const parsed = upsertProfileSchema.parse(input);

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...parsed },
      update: { ...parsed },
    });

    return toResult(profile);
  }
}

export const profileService = new ProfileService();
