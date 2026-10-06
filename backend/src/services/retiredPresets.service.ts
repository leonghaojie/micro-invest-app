/**
 * Retires the original single-fund presets (Conservative, Balanced, Growth; DECISIONS.md #28).
 *
 * They were one fund each, so anything that points at one can point at the fund instead:
 *  - an account still on the old fixed plan is turned into ledger rows first (the same migration
 *    as before, backfillLegacyPlans), which stops it pointing at a portfolio at all;
 *  - a monthly buy of one of them becomes a monthly buy of that fund, with its history (runs,
 *    skipped months) kept; if the account already had a monthly buy of that fund, the two are
 *    merged into one (amounts added) so the fund is not bought twice a month;
 *  - then the preset itself is deleted, if nothing points at it any more.
 *
 * Ledger history needs no conversion: buys and sells are already recorded per fund. Idempotent, and
 * safe to run on every seed: with nothing left to retire it does nothing.
 */
import { prisma } from "../config/prisma";
import { addMonths } from "../utils/ledger";
import { RETIRED_PRESETS } from "../utils/presetPortfolios";
import { backfillLegacyPlans } from "./ledgerBackfill.service";
import { getClock, monthDate, monthKey } from "./ledger.service";

export interface RetireResult {
  /** Monthly buys that now point at the fund instead of the preset. */
  rulesConverted: number;
  /** Monthly buys folded into another one for the same fund. */
  rulesMerged: number;
  /** Presets deleted. */
  deleted: string[];
  /** Presets that something still points at, so they were kept. */
  kept: string[];
}

export async function retireLegacyPresets(): Promise<RetireResult> {
  const result: RetireResult = { rulesConverted: 0, rulesMerged: 0, deleted: [], kept: [] };

  const presets = await prisma.portfolio.findMany({
    where: { isPreset: true, userId: null, name: { in: RETIRED_PRESETS.map((p) => p.name) } },
    include: { allocations: { select: { fundId: true } } },
  });
  if (presets.length === 0) return result;

  // An account still on the old fixed plan becomes a ledger first, which clears its pointer to a portfolio.
  await backfillLegacyPlans();

  const clock = await getClock();
  const lastMonth = monthDate(addMonths(clock.tradeMonth, -1));

  for (const preset of presets) {
    // Anything that is not exactly one fund is not what was retired: leave it alone.
    if (preset.allocations.length !== 1) {
      result.kept.push(preset.name);
      continue;
    }
    const fundId = preset.allocations[0].fundId;

    const rules = await prisma.recurringRule.findMany({ where: { portfolioId: preset.id }, select: { id: true, planId: true, endMonth: true } });
    for (const rule of rules) {
      await prisma.recurringRule.update({ where: { id: rule.id }, data: { fundId, portfolioId: null } });
      result.rulesConverted += 1;
    }

    // One active monthly buy per account and fund: fold the extras into the oldest.
    for (const planId of new Set(rules.map((r) => r.planId))) {
      const active = await prisma.recurringRule.findMany({ where: { planId, fundId, endMonth: null }, orderBy: { createdAt: "asc" } });
      if (active.length < 2) continue;
      const [keeper, ...extras] = active;
      const total = active.reduce((sum, r) => sum + Number(r.amount), 0);
      await prisma.recurringRule.update({ where: { id: keeper.id }, data: { amount: total.toFixed(2) } });
      for (const extra of extras) {
        // One that has not started yet never ran, so it can go; otherwise it ends last month and its history stays.
        if (monthKey(extra.startMonth) > monthKey(lastMonth)) await prisma.recurringRule.delete({ where: { id: extra.id } });
        else await prisma.recurringRule.update({ where: { id: extra.id }, data: { endMonth: lastMonth } });
        result.rulesMerged += 1;
      }
    }

    const [plans, remaining] = await Promise.all([
      prisma.plan.count({ where: { portfolioId: preset.id } }),
      prisma.recurringRule.count({ where: { portfolioId: preset.id } }),
    ]);
    if (plans === 0 && remaining === 0) {
      await prisma.portfolio.delete({ where: { id: preset.id } });
      result.deleted.push(preset.name);
    } else {
      result.kept.push(preset.name);
    }
  }
  return result;
}
