/**
 * CheckInService (DECISIONS.md #31): the monthly "what did you earn and spend this month?".
 *
 * The profile's income and expenses are the USUAL figures: they credit every month by default. A
 * check-in tells the app what really happened in the current trade month. It replaces that month's
 * cash credit with income minus expenses (which can be negative: a big purchase is paid from the
 * cash the account has) and leaves the profile alone, so a one-off never repeats next month.
 * Ticking "make these my usual figures" changes the profile as well, for a real change such as a
 * new job.
 *
 * A check-in the cash cannot cover is refused, with the options (sell something, or lower the
 * expense), the same way a profile edit is. Past months are never touched.
 */
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { round2, spareIncome } from "../utils/ledger";
import { advance, computeState, ensureAccount, getClock, lockPlan, monthDate, persistDerived, Tx } from "./ledger.service";

const MAX_AMOUNT = 10_000_000;

const checkInSchema = z.object({
  income: z.number({ invalid_type_error: "Enter this month's income" }).min(0, "Income cannot be negative").max(MAX_AMOUNT, "Enter a realistic income"),
  expense: z.number({ invalid_type_error: "Enter this month's spending" }).min(0, "Spending cannot be negative").max(MAX_AMOUNT, "Enter a realistic amount"),
  /** Also make these the usual figures on the profile. */
  makeUsual: z.boolean().optional(),
});

export interface CheckInView {
  /** The trade month this check-in is for, "YYYY-MM". */
  month: string;
  /** True once the user has confirmed or updated the month. */
  confirmed: boolean;
  /** The profile's usual figures. */
  usual: { income: number; expense: number };
  /** This month's figures: what the user reported, or the usual ones until they do. */
  thisMonth: { income: number; expense: number };
  /** What this month adds to (or takes from) cash: income minus expenses, possibly negative. */
  credit: number;
  /** Cash now, after this month's credit and any purchases. */
  cash: number;
}

async function buildView(tx: Tx, planId: string, userId: string, month: string, cash: number): Promise<CheckInView> {
  const [profile, checkIn, credit] = await Promise.all([
    tx.userProfile.findUnique({ where: { userId } }),
    tx.monthlyCheckIn.findUnique({ where: { planId_month: { planId, month: monthDate(month) } } }),
    tx.cashCredit.findUnique({ where: { planId_month: { planId, month: monthDate(month) } } }),
  ]);
  if (!profile) throw new HttpError(404, "Set up your profile first");
  const usual = { income: Number(profile.monthlyIncome), expense: Number(profile.monthlyExpense) };
  return {
    month,
    confirmed: checkIn !== null,
    usual,
    thisMonth: checkIn ? { income: Number(checkIn.income), expense: Number(checkIn.expense) } : usual,
    credit: credit ? Number(credit.amount) : 0,
    cash,
  };
}

class CheckInService {
  /** The current trade month's check-in: whether it has been confirmed, and the figures to prefill. */
  async current(userId: string): Promise<CheckInView> {
    const clock = await getClock();
    return prisma.$transaction(
      async (tx) => {
        const plan = await ensureAccount(tx, userId, clock);
        await lockPlan(tx, plan.id);
        await advance(tx, plan.id, userId, clock);
        const state = await computeState(tx, plan.id, clock);
        await persistDerived(tx, plan.id, state, clock);
        return buildView(tx, plan.id, userId, clock.tradeMonth, state.cash);
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  }

  /**
   * Records what the user earned and spent this month. Replaces the month's cash credit with the
   * difference; refused if the cash left after this month's purchases cannot cover a shortfall.
   */
  async submit(userId: string, input: unknown): Promise<CheckInView> {
    const parsed = checkInSchema.parse(input);
    if (parsed.makeUsual && parsed.income <= 0) {
      throw new HttpError(400, "Your usual monthly income must be greater than 0. Save this for this month only, or enter your usual income.");
    }
    const clock = await getClock();
    return prisma.$transaction(
      async (tx) => {
        const plan = await ensureAccount(tx, userId, clock);
        await lockPlan(tx, plan.id);
        // Credit every earlier month at the usual figures first, so only this month is changed.
        await advance(tx, plan.id, userId, clock);

        const month = monthDate(clock.tradeMonth);
        const credit = await tx.cashCredit.findUnique({ where: { planId_month: { planId: plan.id, month } } });
        if (!credit) throw new HttpError(500, "This month's cash has not been credited yet");

        const newCredit = spareIncome(parsed.income, parsed.expense);
        const delta = round2(newCredit - Number(credit.amount));
        const before = await computeState(tx, plan.id, clock);
        if (before.cash + delta < -0.005) throw new HttpError(422, shortfallMessage(newCredit, delta, before.cash, Number(credit.amount)));

        await tx.cashCredit.update({ where: { id: credit.id }, data: { amount: newCredit, source: "CHECKIN" } });
        await tx.monthlyCheckIn.upsert({
          where: { planId_month: { planId: plan.id, month } },
          create: { planId: plan.id, month, income: parsed.income, expense: parsed.expense },
          update: { income: parsed.income, expense: parsed.expense },
        });
        if (parsed.makeUsual) {
          await tx.userProfile.update({ where: { userId }, data: { monthlyIncome: parsed.income, monthlyExpense: parsed.expense } });
        }

        const state = await computeState(tx, plan.id, clock);
        await persistDerived(tx, plan.id, state, clock);
        return buildView(tx, plan.id, userId, clock.tradeMonth, state.cash);
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  }
}

function shortfallMessage(newCredit: number, delta: number, cash: number, oldCredit: number): string {
  if (newCredit < 0) {
    // The cash that can pay for the overspend is what was saved before this month: this month's own credit is being replaced.
    const saved = `$${Math.max(0, round2(cash - oldCredit)).toFixed(2)}`;
    return `This month you would spend $${Math.abs(newCredit).toFixed(2)} more than you earn, but you have only ${saved} in cash saved from before this month (and anything you have already bought this month is spent). Sell something first, or enter a smaller expense.`;
  }
  return `This would lower this month's cash by $${Math.abs(delta).toFixed(2)}, but you have only $${Math.max(0, cash).toFixed(2)} left after your purchases. Sell something first, or enter different figures.`;
}

export const checkInService = new CheckInService();
