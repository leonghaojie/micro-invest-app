/**
 * LedgerService (DECISIONS.md #19): the database side of the ledger. The arithmetic is in
 * utils/ledger.ts; this file loads the facts, keeps them up to date as months pass, and
 * stores what the replay derives.
 *
 * The facts are cash_credits (one per month), ledger_entries (buys and sells) and
 * recurring_rules / recurring_runs. Everything else is derived on read and re-stored,
 * the same "recompute on read" pattern the old plan engine used: plan_months (a snapshot
 * per month with data), plan_holdings (what is held now) and plan.contributionAmount.
 *
 * "Catching up" (`advance`) is what makes time pass for an account: it credits the month's
 * spare income for every trade month not yet credited, then runs each active recurring buy
 * once for every month it has not yet run. It is idempotent and safe to call on every
 * read; it also runs for every account after each monthly fund-data update.
 */
import { Prisma, TradeSource } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import {
  addMonths,
  averageMonthlyBuy,
  Credit,
  creditFor,
  FundReturns,
  LedgerEntry,
  monthRange,
  ReplayResult,
  replay,
  round2,
  spareIncome,
  splitByWeights,
  tradeMonthAfter,
} from "../utils/ledger";
import { oldestLatestMonth } from "./fundClock";

export type Tx = Prisma.TransactionClient;

export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const monthDate = (key: string) => new Date(`${key}-01T00:00:00.000Z`);

export interface AccountClock {
  /** The latest month with data for every fund. */
  latestDataMonth: string;
  /** The month trades are made in now: the month after the latest data. */
  tradeMonth: string;
}

/** The two months that frame everything, or a 503 if there is no fund data at all yet. */
export async function getClock(): Promise<AccountClock> {
  const latest = await oldestLatestMonth();
  if (!latest) throw new HttpError(503, "Fund data isn't available yet. Please try again later.");
  return { latestDataMonth: latest, tradeMonth: tradeMonthAfter(latest) };
}

/** Locks the account row until the transaction ends, so two requests cannot overspend. */
export async function lockPlan(tx: Tx, planId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM plans WHERE id = ${planId} FOR UPDATE`;
}

export interface Facts {
  credits: Credit[];
  entries: LedgerEntry[];
}

export async function loadFacts(tx: Tx, planId: string): Promise<Facts> {
  const [credits, entries] = await Promise.all([
    tx.cashCredit.findMany({ where: { planId }, orderBy: { month: "asc" } }),
    tx.ledgerEntry.findMany({ where: { planId }, orderBy: [{ month: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
  ]);
  return {
    credits: credits.map((c) => ({ month: monthKey(c.month), amount: Number(c.amount) })),
    entries: entries.map((e) => ({ month: monthKey(e.month), side: e.side, fundId: e.fundId, amount: Number(e.amount) })),
  };
}

/** Monthly returns (fractions) for the funds, from `fromMonth` on. */
export async function loadReturns(tx: Tx, fundIds: string[], fromMonth: string): Promise<FundReturns> {
  if (fundIds.length === 0) return {};
  const rows = await tx.fundMonthlyReturn.findMany({
    where: { fundId: { in: fundIds }, monthDate: { gte: monthDate(fromMonth) } },
    select: { fundId: true, monthDate: true, returnPct: true },
  });
  const out: FundReturns = {};
  for (const r of rows) (out[r.fundId] ??= {})[monthKey(r.monthDate)] = Number(r.returnPct);
  return out;
}

export interface AccountState extends ReplayResult {
  facts: Facts;
}

/** Folds the facts into the account's current state (read-only). */
export async function computeState(tx: Tx, planId: string, clock: AccountClock): Promise<AccountState> {
  const facts = await loadFacts(tx, planId);
  const months = [...facts.credits.map((c) => c.month), ...facts.entries.map((e) => e.month)].sort();
  const returns = await loadReturns(tx, [...new Set(facts.entries.map((e) => e.fundId))], months[0] ?? clock.tradeMonth);
  try {
    return { ...replay({ ...facts, returns, latestDataMonth: clock.latestDataMonth }), facts };
  } catch (err) {
    throw new HttpError(500, err instanceof Error ? err.message : "Could not work out the account");
  }
}

/** Cash available at the start of `month`: credits up to it, sells and buys before it (and in it so far). */
async function cashAtStartOf(tx: Tx, planId: string, month: string): Promise<number> {
  const upTo = { lte: monthDate(month) };
  const [credits, buys, sells] = await Promise.all([
    tx.cashCredit.aggregate({ where: { planId, month: upTo }, _sum: { amount: true } }),
    tx.ledgerEntry.aggregate({ where: { planId, side: "BUY", month: upTo }, _sum: { amount: true } }),
    tx.ledgerEntry.aggregate({ where: { planId, side: "SELL", month: upTo }, _sum: { amount: true } }),
  ]);
  return round2(Number(credits._sum.amount ?? 0) + Number(sells._sum.amount ?? 0) - Number(buys._sum.amount ?? 0));
}

// ── Accounts ─────────────────────────────────────────────────────────────

/**
 * The user's account, created on first need with the opening credit: the spare income of
 * the setup form, credited immediately as this month's cash (DECISIONS.md #19).
 */
export async function ensureAccount(tx: Tx, userId: string, clock: AccountClock) {
  const existing = await tx.plan.findUnique({ where: { userId } });
  if (existing) return existing;
  const profile = await tx.userProfile.findUnique({ where: { userId } });
  if (!profile) throw new HttpError(404, "Set up your profile first");
  const plan = await tx.plan.create({ data: { userId, startMonth: monthDate(clock.tradeMonth), contributionAmount: 0 } });
  await tx.cashCredit.create({
    data: {
      planId: plan.id,
      month: monthDate(clock.tradeMonth),
      // No cash yet, so a month that spends more than it earns opens the account at zero.
      amount: creditFor(spareIncome(Number(profile.monthlyIncome), Number(profile.monthlyExpense)), 0),
      source: "SETUP",
    },
  });
  return plan;
}

/**
 * Brings the account up to the trade month, one month at a time: a credit for the month if it has
 * none (at the profile's usual spare income, which is right because profile edits first catch up
 * before they apply; a deficit is paid from the cash the account has, DECISIONS.md #31), then the
 * recurring buys due that month. Doing the months in order matters: a deficit and a skipped buy
 * both depend on the cash left by the months before. Idempotent.
 */
export async function advance(tx: Tx, planId: string, userId: string, clock: AccountClock): Promise<void> {
  const profile = await tx.userProfile.findUnique({ where: { userId } });
  if (!profile) throw new HttpError(404, "Set up your profile first");

  const credits = await tx.cashCredit.findMany({ where: { planId }, select: { month: true }, orderBy: { month: "asc" } });
  const have = new Set(credits.map((c) => monthKey(c.month)));
  const first = credits.length > 0 ? monthKey(credits[0].month) : clock.tradeMonth;
  const spare = spareIncome(Number(profile.monthlyIncome), Number(profile.monthlyExpense));

  const rules = await loadRules(tx, planId);
  const firstRule = rules.map((r) => monthKey(r.startMonth)).sort()[0];
  const start = firstRule !== undefined && firstRule < first ? firstRule : first;
  for (const month of monthRange(start, clock.tradeMonth)) {
    if (month >= first && !have.has(month)) {
      const amount = spare >= 0 ? spare : creditFor(spare, await cashAtStartOf(tx, planId, month));
      await tx.cashCredit.createMany({ data: [{ planId, month: monthDate(month), amount, source: "MONTHLY" as const }], skipDuplicates: true });
    }
    await runRulesForMonth(tx, planId, month, rules);
  }
}

/** The account's monthly buys with the runs each already has and the weights of a portfolio target. */
async function loadRules(tx: Tx, planId: string) {
  return tx.recurringRule.findMany({
    where: { planId },
    include: { runs: true, portfolio: { include: { allocations: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
type LoadedRule = Awaited<ReturnType<typeof loadRules>>[number];

/** Runs every active recurring buy once for each month it has not yet run, oldest month first. */
export async function runDueRules(tx: Tx, planId: string, clock: AccountClock): Promise<void> {
  const rules = await loadRules(tx, planId);
  if (rules.length === 0) return;
  const firstMonth = rules.map((r) => monthKey(r.startMonth)).sort()[0];
  for (const month of monthRange(firstMonth, clock.tradeMonth)) await runRulesForMonth(tx, planId, month, rules);
}

/** Runs each active recurring buy that has not yet run in `month`: bought if the cash covers it, else skipped. */
async function runRulesForMonth(tx: Tx, planId: string, month: string, rules: LoadedRule[]): Promise<void> {
  for (const rule of rules) {
    const start = monthKey(rule.startMonth);
    const end = rule.endMonth ? monthKey(rule.endMonth) : null;
    if (month < start || (end !== null && month > end)) continue;
    if (rule.runs.some((r) => monthKey(r.month) === month)) continue;

    const amount = Number(rule.amount);
    const legs = rule.fundId
      ? [{ fundId: rule.fundId, amount }]
      : splitByWeights(amount, (rule.portfolio?.allocations ?? []).map((a) => ({ fundId: a.fundId, weightPct: Number(a.weightPct) })));

    const cash = await cashAtStartOf(tx, planId, month);
    if (legs.length === 0 || cash < amount) {
      await tx.recurringRun.create({ data: { ruleId: rule.id, month: monthDate(month), status: "SKIPPED" } });
      rule.runs.push({ id: "", ruleId: rule.id, month: monthDate(month), status: "SKIPPED", createdAt: new Date() });
      continue;
    }
    const batchId = randomUUID();
    await tx.ledgerEntry.createMany({
      data: legs.map((l) => ({ planId, month: monthDate(month), side: "BUY" as const, fundId: l.fundId, amount: l.amount, source: "RECURRING" as TradeSource, batchId })),
    });
    await tx.recurringRun.create({ data: { ruleId: rule.id, month: monthDate(month), status: "BOUGHT" } });
    rule.runs.push({ id: "", ruleId: rule.id, month: monthDate(month), status: "BOUGHT", createdAt: new Date() });
  }
}

// ── Derived data ─────────────────────────────────────────────────────────

/** Stores what the replay derives: monthly snapshots, current holdings, typical monthly buy. */
export async function persistDerived(tx: Tx, planId: string, state: AccountState, clock: AccountClock): Promise<void> {
  for (const p of state.points) {
    const data = {
      portfolioReturnPct: Math.round(p.portfolioReturn * 1_000_000) / 1_000_000,
      contribution: p.netFlow,
      endingBalance: p.endingValue,
      totalInvested: p.totalInvested,
      walletBalance: p.cash,
      hasPosition: p.hasPosition,
    };
    await tx.planMonth.upsert({
      where: { planId_monthDate: { planId, monthDate: monthDate(p.month) } },
      create: { planId, monthDate: monthDate(p.month), ...data },
      update: data,
    });
  }
  await tx.planHolding.deleteMany({ where: { planId } });
  if (state.holdings.length > 0) {
    await tx.planHolding.createMany({ data: state.holdings.map((h) => ({ planId, fundId: h.fundId, value: h.value, costBasis: h.costBasis })) });
  }
  const accountStart = state.facts.credits.map((c) => c.month).sort()[0] ?? clock.tradeMonth;
  await tx.plan.update({
    where: { id: planId },
    data: {
      contributionAmount: averageMonthlyBuy(state.facts.entries, clock.tradeMonth),
      startMonth: monthDate(state.firstBuyMonth ?? accountStart),
    },
  });
}

/** Catches the account up, replays it, stores the result and returns it. One transaction. */
export async function refreshAccount(userId: string, opts: { advance?: boolean } = {}): Promise<{ planId: string; clock: AccountClock; state: AccountState } | null> {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { userId: true } });
  if (!profile) return null;
  // Reading someone else's account never opens one for them.
  if (opts.advance === false && !(await prisma.plan.findUnique({ where: { userId }, select: { id: true } }))) return null;
  const clock = await getClock();

  return prisma.$transaction(
    async (tx) => {
      const plan = await ensureAccount(tx, userId, clock);
      await lockPlan(tx, plan.id);
      if (opts.advance !== false) await advance(tx, plan.id, userId, clock);
      const state = await computeState(tx, plan.id, clock);
      await persistDerived(tx, plan.id, state, clock);
      return { planId: plan.id, clock, state };
    },
    { timeout: 20_000, maxWait: 10_000 }
  );
}

export { addMonths, round2 };
