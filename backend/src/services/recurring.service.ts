/**
 * RecurringService (DECISIONS.md #19, PR 3): set up, change, pause and resume a monthly buy.
 *
 * A rule is a standing instruction to buy a fixed dollar amount of one fund or one portfolio
 * each trade month. The runner (ledger.service.ts `runDueRules`) executes it whenever the
 * account is caught up: a BOUGHT run when the month's cash covers it, otherwise a SKIPPED
 * run, which stays visible and counts against contribution consistency.
 *
 * Rules are history, never edited in place:
 *  - pause ends the rule (endMonth = this month: it has already run this month);
 *  - resume reopens it if it was paused this very month (so it cannot buy twice in a month),
 *    otherwise starts a new rule from this month;
 *  - changing the amount ends the rule this month and starts a new one next month.
 */
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { addMonths, Consistency, contributionConsistency } from "../utils/ledger";
import { advance, computeState, ensureAccount, getClock, lockPlan, monthDate, monthKey, persistDerived, runDueRules, Tx } from "./ledger.service";

/** The most monthly buys an account may have running at once. */
export const MAX_ACTIVE_RULES = 10;
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 100_000;

const amountSchema = z.number().min(MIN_AMOUNT, `The smallest monthly buy is $${MIN_AMOUNT}`).max(MAX_AMOUNT, `The largest monthly buy is $${MAX_AMOUNT}`);

const createSchema = z
  .object({ fundId: z.string().uuid().optional(), portfolioId: z.string().uuid().optional(), amount: amountSchema })
  .refine((v) => (v.fundId ? 1 : 0) + (v.portfolioId ? 1 : 0) === 1, { message: "Choose either a fund or a portfolio" });

const changeSchema = z.object({ amount: amountSchema });

export interface RuleView {
  id: string;
  kind: "FUND" | "PORTFOLIO";
  targetName: string;
  fundId: string | null;
  portfolioId: string | null;
  amount: number;
  status: "ACTIVE" | "PAUSED";
  /** First month it runs, YYYY-MM; later than the trade month for a rule that starts next month. */
  startMonth: string;
  /** Last month it runs in while paused, else null. */
  endMonth: string | null;
  /** Newest first. */
  runs: { month: string; status: "BOUGHT" | "SKIPPED" }[];
}

export interface RecurringOverview {
  tradeMonth: string | null;
  rules: RuleView[];
  /** How regularly the user invests, or null with too little history. */
  consistency: Consistency | null;
}

type RuleRow = Awaited<ReturnType<typeof loadRules>>[number];

function loadRules(tx: Tx, planId: string) {
  return tx.recurringRule.findMany({
    where: { planId },
    include: {
      fund: { select: { ticker: true, name: true } },
      portfolio: { select: { name: true } },
      runs: { orderBy: { month: "desc" }, take: 6 },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

function toView(r: RuleRow): RuleView {
  return {
    id: r.id,
    kind: r.fundId ? "FUND" : "PORTFOLIO",
    targetName: r.fund ? `${r.fund.ticker} · ${r.fund.name}` : (r.portfolio?.name ?? "A portfolio that no longer exists"),
    fundId: r.fundId,
    portfolioId: r.portfolioId,
    amount: Number(r.amount),
    status: r.endMonth ? "PAUSED" : "ACTIVE",
    startMonth: monthKey(r.startMonth),
    endMonth: r.endMonth ? monthKey(r.endMonth) : null,
    runs: r.runs.map((x) => ({ month: monthKey(x.month), status: x.status })),
  };
}

const targetKey = (r: { fundId: string | null; portfolioId: string | null }) => (r.fundId ? `f:${r.fundId}` : `p:${r.portfolioId}`);

/** The newest rule for each target: older ones were ended by a change of amount or a pause and resume. */
function latestPerTarget(rows: RuleRow[]): RuleRow[] {
  const seen = new Set<string>();
  const out: RuleRow[] = [];
  for (const r of rows) {
    const k = targetKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

async function buyMonths(tx: Tx, planId: string): Promise<string[]> {
  const rows = await tx.ledgerEntry.groupBy({ by: ["month"], where: { planId, side: "BUY" } });
  return rows.map((r) => monthKey(r.month));
}

class RecurringService {
  /** Runs `fn` on a locked, caught-up account. */
  private async withAccount<T>(userId: string, fn: (tx: Tx, planId: string, clock: Awaited<ReturnType<typeof getClock>>) => Promise<T>): Promise<T> {
    const clock = await getClock();
    return prisma.$transaction(
      async (tx) => {
        const plan = await ensureAccount(tx, userId, clock);
        await lockPlan(tx, plan.id);
        await advance(tx, plan.id, userId, clock);
        const result = await fn(tx, plan.id, clock);
        await persistDerived(tx, plan.id, await computeState(tx, plan.id, clock), clock);
        return result;
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  }

  async list(userId: string): Promise<RecurringOverview> {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { userId: true } });
    if (!profile) return { tradeMonth: null, rules: [], consistency: null };
    return this.withAccount(userId, async (tx, planId, clock) => ({
      tradeMonth: clock.tradeMonth,
      rules: latestPerTarget(await loadRules(tx, planId)).map(toView),
      consistency: contributionConsistency(await buyMonths(tx, planId), clock.tradeMonth),
    }));
  }

  async create(userId: string, input: unknown): Promise<{ rule: RuleView; firstRun: "BOUGHT" | "SKIPPED" | null; cash: number }> {
    const parsed = createSchema.parse(input);
    return this.withAccount(userId, async (tx, planId, clock) => {
      if (parsed.fundId) {
        if (!(await tx.fund.findUnique({ where: { id: parsed.fundId }, select: { id: true } }))) throw new HttpError(404, "Fund not found");
      } else {
        const pf = await tx.portfolio.findUnique({ where: { id: parsed.portfolioId }, include: { allocations: { select: { id: true } } } });
        if (!pf || (pf.userId && pf.userId !== userId)) throw new HttpError(404, "Portfolio not found");
        if (pf.allocations.length === 0) throw new HttpError(400, "Portfolio has no fund allocations");
      }

      const latest = latestPerTarget(await loadRules(tx, planId));
      const active = latest.filter((r) => !r.endMonth);
      if (active.length >= MAX_ACTIVE_RULES) throw new HttpError(422, `You can have at most ${MAX_ACTIVE_RULES} monthly buys running. Pause one first.`);
      const same = active.find((r) => targetKey(r) === (parsed.fundId ? `f:${parsed.fundId}` : `p:${parsed.portfolioId}`));
      if (same) throw new HttpError(409, "You already have a monthly buy for this. Change its amount instead.");

      const rule = await tx.recurringRule.create({
        data: { planId, fundId: parsed.fundId ?? null, portfolioId: parsed.portfolioId ?? null, amount: parsed.amount, startMonth: monthDate(clock.tradeMonth) },
      });
      await runDueRules(tx, planId, clock); // the first buy happens now, if there is cash
      const [view, state] = await Promise.all([this.viewOf(tx, planId, rule.id), computeState(tx, planId, clock)]);
      return { rule: view, firstRun: view.runs.find((r) => r.month === clock.tradeMonth)?.status ?? null, cash: state.cash };
    });
  }

  async pause(userId: string, ruleId: string): Promise<RuleView> {
    return this.withAccount(userId, async (tx, planId, clock) => {
      const rule = await this.ownRule(tx, planId, ruleId);
      if (rule.endMonth) throw new HttpError(409, "This monthly buy is already paused.");
      // It has already run this month (the account was just caught up), so it stops from next month.
      await tx.recurringRule.update({ where: { id: ruleId }, data: { endMonth: monthDate(clock.tradeMonth) } });
      return this.viewOf(tx, planId, ruleId);
    });
  }

  async resume(userId: string, ruleId: string): Promise<{ rule: RuleView; firstRun: "BOUGHT" | "SKIPPED" | null }> {
    return this.withAccount(userId, async (tx, planId, clock) => {
      const rule = await this.ownRule(tx, planId, ruleId);
      if (!rule.endMonth) throw new HttpError(409, "This monthly buy is already running.");

      const latest = latestPerTarget(await loadRules(tx, planId));
      if (latest.find((r) => targetKey(r) === targetKey(rule))?.id !== ruleId) throw new HttpError(409, "A newer monthly buy exists for this; resume that one.");
      if (latest.filter((r) => !r.endMonth).length >= MAX_ACTIVE_RULES) throw new HttpError(422, `You can have at most ${MAX_ACTIVE_RULES} monthly buys running. Pause one first.`);

      // Paused this very month: it already ran, so reopen it rather than start a second one.
      if (monthKey(rule.endMonth) >= clock.tradeMonth) {
        await tx.recurringRule.update({ where: { id: ruleId }, data: { endMonth: null } });
        return { rule: await this.viewOf(tx, planId, ruleId), firstRun: null };
      }

      const fresh = await tx.recurringRule.create({
        data: { planId, fundId: rule.fundId, portfolioId: rule.portfolioId, amount: rule.amount, startMonth: monthDate(clock.tradeMonth) },
      });
      await runDueRules(tx, planId, clock);
      const view = await this.viewOf(tx, planId, fresh.id);
      return { rule: view, firstRun: view.runs.find((r) => r.month === clock.tradeMonth)?.status ?? null };
    });
  }

  /** Ends the rule this month and starts a new one with the new amount next month. */
  async changeAmount(userId: string, ruleId: string, input: unknown): Promise<RuleView> {
    const { amount } = changeSchema.parse(input);
    return this.withAccount(userId, async (tx, planId, clock) => {
      const rule = await this.ownRule(tx, planId, ruleId);
      if (rule.endMonth) throw new HttpError(409, "Resume this monthly buy before changing it.");
      if (monthKey(rule.startMonth) > clock.tradeMonth) throw new HttpError(409, "This monthly buy has not started yet; its amount was already changed this month.");
      if (Number(rule.amount) === amount) return this.viewOf(tx, planId, ruleId);

      await tx.recurringRule.update({ where: { id: ruleId }, data: { endMonth: monthDate(clock.tradeMonth) } });
      const next = await tx.recurringRule.create({
        data: { planId, fundId: rule.fundId, portfolioId: rule.portfolioId, amount, startMonth: monthDate(addMonths(clock.tradeMonth, 1)) },
      });
      return this.viewOf(tx, planId, next.id);
    });
  }

  private async ownRule(tx: Tx, planId: string, ruleId: string) {
    const rule = await tx.recurringRule.findUnique({ where: { id: ruleId } });
    // Someone else's rule is a 404 too, so ids cannot be probed.
    if (!rule || rule.planId !== planId) throw new HttpError(404, "Monthly buy not found");
    return rule;
  }

  private async viewOf(tx: Tx, planId: string, ruleId: string): Promise<RuleView> {
    const row = (await loadRules(tx, planId)).find((r) => r.id === ruleId);
    if (!row) throw new HttpError(404, "Monthly buy not found");
    return toView(row);
  }
}

export const recurringService = new RecurringService();
