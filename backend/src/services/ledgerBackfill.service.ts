/**
 * Turns the old fixed plans into ledger rows (DECISIONS.md #19, "Migration").
 *
 * A legacy plan is a Plan row that still has a portfolioId: one portfolio, one monthly
 * amount, one start month. Its history becomes:
 *   - a MIGRATED cash credit for each month from the start month to the latest data month
 *     (the user's spare income, so cash matches the old wallet whenever contributions fit);
 *   - a MIGRATED buy per fund per month (the monthly amount split by the portfolio's weights);
 *   - an active recurring buy for the same portfolio and amount from the trade month on, so
 *     the contributions keep going.
 * Then the plan's portfolioId is cleared, which is what marks it done. Idempotent: a plan
 * with no portfolioId is skipped. The seed script uses it too, to give synthetic peers a
 * history through the same path as real accounts.
 */
import { prisma } from "../config/prisma";
import { monthRange, spareIncome, splitByWeights } from "../utils/ledger";
import { getClock, monthDate, monthKey, Tx } from "./ledger.service";
import { refreshAccount } from "./ledger.service";

export interface BackfillResult {
  migrated: number;
  skipped: number;
}

/** Says whether the account of `userId` buys in `month`. Real accounts always do (their old plan did). */
export type BuysInMonth = (userId: string, month: string) => boolean;

export interface BackfillOptions {
  /** Which months get a buy. Default: every month, as the old plan did. */
  buys?: BuysInMonth;
  /** Whether the account keeps a monthly buy going forward. Default: yes. The seed leaves it off for irregular synthetic peers. */
  recurring?: (userId: string) => boolean;
}

async function migrateOne(tx: Tx, planId: string, clock: { latestDataMonth: string; tradeMonth: string }, options: BackfillOptions): Promise<boolean> {
  const buys = options.buys ?? (() => true);
  const plan = await tx.plan.findUnique({
    where: { id: planId },
    include: { portfolio: { include: { allocations: true } }, user: { include: { profile: true } } },
  });
  if (!plan || !plan.portfolioId || !plan.portfolio || !plan.user.profile) return false;

  const profile = plan.user.profile;
  const contribution = Number(plan.contributionAmount);
  const weights = plan.portfolio.allocations.map((a) => ({ fundId: a.fundId, weightPct: Number(a.weightPct) }));
  const start = monthKey(plan.startMonth);
  const months = start <= clock.latestDataMonth ? monthRange(start, clock.latestDataMonth) : [];
  const spare = spareIncome(Number(profile.monthlyIncome), Number(profile.monthlyExpense));

  if (months.length > 0) {
    await tx.cashCredit.createMany({
      data: months.map((m) => ({ planId, month: monthDate(m), amount: spare, source: "MIGRATED" as const })),
      skipDuplicates: true,
    });
    const legs = splitByWeights(contribution, weights);
    await tx.ledgerEntry.createMany({
      data: months.filter((m) => buys(plan.userId, m)).flatMap((m) => legs.map((l) => ({ planId, month: monthDate(m), side: "BUY" as const, fundId: l.fundId, amount: l.amount, source: "MIGRATED" as const }))),
    });
  }
  if (contribution > 0 && (options.recurring?.(plan.userId) ?? true)) {
    await tx.recurringRule.create({
      data: { planId, portfolioId: plan.portfolioId, amount: contribution, startMonth: monthDate(clock.tradeMonth) },
    });
  }
  await tx.plan.update({ where: { id: planId }, data: { portfolioId: null } });
  return true;
}

/** Migrates every legacy plan, then derives each account's state. */
export async function backfillLegacyPlans(options: BackfillOptions = {}): Promise<BackfillResult> {
  const legacy = await prisma.plan.findMany({ where: { portfolioId: { not: null } }, select: { id: true, userId: true } });
  if (legacy.length === 0) return { migrated: 0, skipped: 0 };
  const clock = await getClock();

  let migrated = 0;
  let skipped = 0;
  for (const p of legacy) {
    const done = await prisma.$transaction((tx) => migrateOne(tx, p.id, clock, options), { timeout: 30_000 });
    if (done) migrated += 1;
    else skipped += 1;
  }
  // Credit the trade month, run the first recurring buys and store the derived rows.
  for (const p of legacy) {
    await refreshAccount(p.userId).catch((err) => console.error(`[ledger] could not derive an account after migration: ${err instanceof Error ? err.message : String(err)}`));
  }
  return { migrated, skipped };
}
