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
import { ExperienceLevel, GoalType, RiskLevel } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { round2, spareIncome } from "../utils/ledger";
import { advance, computeState, ensureAccount, getClock, lockPlan, monthDate } from "./ledger.service";

const upsertProfileSchema = z.object({
  riskLevel: z.nativeEnum(RiskLevel),
  goalType: z.nativeEnum(GoalType),
  monthlyIncome: z.number().positive("Monthly income must be greater than 0"),
  monthlyExpense: z.number().nonnegative("Monthly expense cannot be negative"),
  age: z.number().int().min(13, "Age must be at least 13").max(120, "Enter a realistic age"),
  // DECISIONS.md #18: optional so existing clients keep working; left unchanged on an update
  // that omits it, and BEGINNER on first creation.
  experienceLevel: z.nativeEnum(ExperienceLevel).optional(),
});

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;

export interface ProfileResult {
  riskLevel: RiskLevel;
  goalType: GoalType;
  monthlyIncome: number;
  monthlyExpense: number;
  age: number;
  experienceLevel: ExperienceLevel;
  savingsRatePct: number;
}

function computeSavingsRatePct(monthlyIncome: number, monthlyExpense: number): number {
  if (monthlyIncome <= 0) return 0;
  return round2(((monthlyIncome - monthlyExpense) / monthlyIncome) * 100);
}

function toResult(profile: {
  riskLevel: RiskLevel;
  goalType: GoalType;
  monthlyIncome: unknown;
  monthlyExpense: unknown;
  age: number;
  experienceLevel: ExperienceLevel;
}): ProfileResult {
  const monthlyIncome = Number(profile.monthlyIncome);
  const monthlyExpense = Number(profile.monthlyExpense);
  return {
    riskLevel: profile.riskLevel,
    goalType: profile.goalType,
    monthlyIncome,
    monthlyExpense,
    age: profile.age,
    experienceLevel: profile.experienceLevel,
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

  /**
   * Creates the profile, or edits it (DECISIONS.md #19). Creating one opens the account,
   * with the setup's spare income credited as the first month's cash. Editing income or
   * expenses re-prices the CURRENT month's credit only (past months never change); it is
   * refused if money already spent that month would then be more than the cash left.
   * Age, risk, goal and experience have no cash effect.
   */
  async upsertProfile(userId: string, input: unknown): Promise<ProfileResult> {
    const parsed = upsertProfileSchema.parse(input);
    const existing = await prisma.userProfile.findUnique({ where: { userId } });

    if (!existing) {
      const profile = await prisma.userProfile.create({ data: { userId, ...parsed } });
      try {
        const clock = await getClock();
        await prisma.$transaction((tx) => ensureAccount(tx, userId, clock));
      } catch (err) {
        // No fund data yet: the account is opened on first use instead.
        if (!(err instanceof HttpError && err.statusCode === 503)) throw err;
      }
      return toResult(profile);
    }

    const financesChanged = Number(existing.monthlyIncome) !== parsed.monthlyIncome || Number(existing.monthlyExpense) !== parsed.monthlyExpense;
    if (!financesChanged) {
      return toResult(await prisma.userProfile.update({ where: { userId }, data: { ...parsed } }));
    }

    const clock = await getClock();
    const profile = await prisma.$transaction(
      async (tx) => {
        const plan = await ensureAccount(tx, userId, clock);
        await lockPlan(tx, plan.id);
        // Credit every month passed so far at the OLD figures, before the new ones apply.
        await advance(tx, plan.id, userId, clock);

        const updated = await tx.userProfile.update({ where: { userId }, data: { ...parsed } });
        const newSpare = spareIncome(parsed.monthlyIncome, parsed.monthlyExpense);
        const credit = await tx.cashCredit.findUnique({ where: { planId_month: { planId: plan.id, month: monthDate(clock.tradeMonth) } } });
        if (credit) {
          const delta = round2(newSpare - Number(credit.amount));
          const state = await computeState(tx, plan.id, clock);
          if (state.cash + delta < -0.005) {
            throw new HttpError(
              422,
              `This change would lower this month's cash by $${Math.abs(delta).toFixed(2)}, but you have only $${state.cash.toFixed(2)} left after your purchases. Sell something first, or make the change next month.`
            );
          }
          await tx.cashCredit.update({ where: { id: credit.id }, data: { amount: newSpare } });
        }
        return updated;
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
    return toResult(profile);
  }
}

export const profileService = new ProfileService();
