/**
 * TradeService (DECISIONS.md #19): buy and sell. A trade is a ledger entry stamped with the
 * trade month (the month after the latest data) and priced at the latest month-end; it earns
 * that month's return once the month's data arrives.
 *
 * Every trade runs in one transaction that first locks the account row and catches the
 * account up, so two quick taps cannot overspend, and so the cash and holdings a trade is
 * checked against are the real current ones.
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { round2, splitByWeights } from "../utils/ledger";
import { advance, computeState, ensureAccount, getClock, lockPlan, monthDate, monthKey, persistDerived } from "./ledger.service";

/** The smallest trade: one dollar (a sell-all may be less). */
export const MIN_TRADE = 1;

const buySchema = z
  .object({
    fundId: z.string().uuid().optional(),
    portfolioId: z.string().uuid().optional(),
    amount: z.number().min(MIN_TRADE, `The smallest trade is $${MIN_TRADE}`),
  })
  .refine((v) => (v.fundId ? 1 : 0) + (v.portfolioId ? 1 : 0) === 1, { message: "Choose either a fund or a portfolio to buy" });

const sellSchema = z
  .object({
    fundId: z.string().uuid(),
    amount: z.number().min(MIN_TRADE, `The smallest trade is $${MIN_TRADE}`).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.all) !== (v.amount !== undefined), { message: "Give an amount, or choose to sell everything" });

export interface TradeLeg {
  fundId: string;
  ticker: string;
  name: string;
  amount: number;
}

export interface TradeResult {
  side: "BUY" | "SELL";
  /** The month the trade is made in, YYYY-MM. */
  tradeMonth: string;
  legs: TradeLeg[];
  total: number;
  /** Cash after the trade. */
  cash: number;
}

export interface ActivityItem {
  kind: "BUY" | "SELL" | "CREDIT";
  month: string;
  amount: number;
  source: string;
  fundId: string | null;
  ticker: string | null;
  name: string | null;
  batchId: string | null;
  at: string;
}

const cents = (v: number) => Math.round(v * 100);

class TradeService {
  async buy(userId: string, input: unknown): Promise<TradeResult> {
    const parsed = buySchema.parse(input);
    const clock = await getClock();

    return prisma.$transaction(
      async (tx) => {
        const plan = await ensureAccount(tx, userId, clock);
        await lockPlan(tx, plan.id);
        await advance(tx, plan.id, userId, clock);
        const state = await computeState(tx, plan.id, clock);

        let weights: { fundId: string; weightPct: number }[];
        if (parsed.fundId) {
          const fund = await tx.fund.findUnique({ where: { id: parsed.fundId }, select: { id: true } });
          if (!fund) throw new HttpError(404, "Fund not found");
          weights = [{ fundId: fund.id, weightPct: 100 }];
        } else {
          const portfolio = await tx.portfolio.findUnique({ where: { id: parsed.portfolioId }, include: { allocations: true } });
          if (!portfolio || (portfolio.userId && portfolio.userId !== userId)) throw new HttpError(404, "Portfolio not found");
          if (portfolio.allocations.length === 0) throw new HttpError(400, "Portfolio has no fund allocations");
          weights = portfolio.allocations.map((a) => ({ fundId: a.fundId, weightPct: Number(a.weightPct) }));
        }

        if (cents(parsed.amount) > cents(state.cash)) {
          throw new HttpError(422, `Not enough cash: you have $${state.cash.toFixed(2)} available.`);
        }

        const legs = splitByWeights(parsed.amount, weights);
        const batchId = randomUUID();
        await tx.ledgerEntry.createMany({
          data: legs.map((l) => ({ planId: plan.id, month: monthDate(clock.tradeMonth), side: "BUY" as const, fundId: l.fundId, amount: l.amount, source: "MANUAL" as const, batchId })),
        });

        const after = await computeState(tx, plan.id, clock);
        await persistDerived(tx, plan.id, after, clock);
        return { side: "BUY" as const, tradeMonth: clock.tradeMonth, legs: await this.withNames(tx, legs), total: round2(parsed.amount), cash: after.cash };
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  }

  async sell(userId: string, input: unknown): Promise<TradeResult> {
    const parsed = sellSchema.parse(input);
    const clock = await getClock();

    return prisma.$transaction(
      async (tx) => {
        const plan = await ensureAccount(tx, userId, clock);
        await lockPlan(tx, plan.id);
        await advance(tx, plan.id, userId, clock);
        const state = await computeState(tx, plan.id, clock);

        const holding = state.holdings.find((h) => h.fundId === parsed.fundId);
        if (!holding) throw new HttpError(422, "You don't hold this fund.");
        const amount = parsed.all ? holding.value : parsed.amount!;
        if (cents(amount) > cents(holding.value)) {
          throw new HttpError(422, `You can sell at most $${holding.value.toFixed(2)} of this fund.`);
        }

        await tx.ledgerEntry.create({
          data: { planId: plan.id, month: monthDate(clock.tradeMonth), side: "SELL", fundId: parsed.fundId, amount, source: "MANUAL", batchId: randomUUID() },
        });

        const after = await computeState(tx, plan.id, clock);
        await persistDerived(tx, plan.id, after, clock);
        return {
          side: "SELL" as const,
          tradeMonth: clock.tradeMonth,
          legs: await this.withNames(tx, [{ fundId: parsed.fundId, amount }]),
          total: round2(amount),
          cash: after.cash,
        };
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  }

  /** The account's activity, newest first: buys, sells and monthly cash credits. */
  async history(userId: string, limit = 50): Promise<ActivityItem[]> {
    const plan = await prisma.plan.findUnique({ where: { userId }, select: { id: true } });
    if (!plan) return [];
    const [entries, credits] = await Promise.all([
      prisma.ledgerEntry.findMany({ where: { planId: plan.id }, include: { fund: { select: { ticker: true, name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit }),
      prisma.cashCredit.findMany({ where: { planId: plan.id }, orderBy: { month: "desc" }, take: limit }),
    ]);
    const items: ActivityItem[] = [
      ...entries.map((e) => ({
        kind: e.side,
        month: monthKey(e.month),
        amount: Number(e.amount),
        source: e.source,
        fundId: e.fundId,
        ticker: e.fund.ticker,
        name: e.fund.name,
        batchId: e.batchId,
        at: e.createdAt.toISOString(),
      })),
      ...credits.map((c) => ({
        kind: "CREDIT" as const,
        month: monthKey(c.month),
        amount: Number(c.amount),
        source: c.source,
        fundId: null,
        ticker: null,
        name: null,
        batchId: null,
        at: c.createdAt.toISOString(),
      })),
    ];
    // Migrated rows were all written at once; order by month first, then by when they were written.
    items.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return items.slice(0, limit);
  }

  private async withNames(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], legs: { fundId: string; amount: number }[]): Promise<TradeLeg[]> {
    const funds = await tx.fund.findMany({ where: { id: { in: legs.map((l) => l.fundId) } }, select: { id: true, ticker: true, name: true } });
    const byId = new Map(funds.map((f) => [f.id, f]));
    return legs.map((l) => ({ fundId: l.fundId, ticker: byId.get(l.fundId)?.ticker ?? "", name: byId.get(l.fundId)?.name ?? "", amount: round2(l.amount) }));
  }
}

export const tradeService = new TradeService();
