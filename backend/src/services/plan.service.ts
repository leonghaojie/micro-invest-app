/**
 * PlanService — replaces SimulationService (DECISIONS.md #1 third
 * amendment, 25 Aug 2026). Real-calendar monthly backtest: the user picks
 * a portfolio, a monthly contribution amount (capped by their profile's
 * monthlyIncome), and a start month; the plan always runs from there
 * through to the real current month (bounded by how far FundMonthlyReturn
 * data actually reaches) — there's no user-chosen duration or end date.
 *
 * Formula (per the shared spec this amendment is based on):
 *   Rp,t = Σ (weight_i * fund_i.returnPct for month t)
 *   V_t = (V_{t-1} + C) * (1 + Rp,t), V_{start-1} = 0
 *   totalInvested_t = totalInvested_{t-1} + C
 *   wallet_t = wallet_{t-1} + (monthlyIncome - monthlyExpense - C)
 * Deterministic by construction (NFR-04): every input (fund returns,
 * contribution, income/expense) is static stored data, no randomness.
 *
 * One active Plan per user (Plan.userId is @unique) — starting a new plan
 * deletes the old one (cascading its PlanMonths) first.
 *
 * "Recompute on read": getActivePlan re-derives every PlanMonth from
 * scratch on every call and upserts them, rather than maintaining them
 * incrementally — cheap at this scale (a few hundred rows at most) and
 * guarantees new real months / newly-ingested fund data show up without a
 * cron job, matching the "always recomputed fresh" philosophy already
 * documented in peerBenchmark.service.ts.
 */
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

const startPlanSchema = z.object({
  portfolioId: z.string().uuid(),
  contributionAmount: z.number().positive(),
  // ISO date string, e.g. "2026-01-01" — normalized to first-of-month UTC.
  startMonth: z.string().min(1),
});

export type StartPlanInput = z.infer<typeof startPlanSchema>;

export interface PlanMonthPoint {
  monthDate: string; // YYYY-MM-01
  portfolioReturnPct: number;
  contribution: number;
  endingBalance: number;
  totalInvested: number;
  walletBalance: number;
}

export interface PlanSummary {
  planId: string;
  portfolioId: string;
  portfolioName: string;
  contributionAmount: number;
  startMonth: string;
  finalValue: number;
  totalContributed: number;
  growth: number;
  walletBalance: number;
  months: PlanMonthPoint[];
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, n: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}

interface AllocationInput {
  weightPct: number; // 0-100
  ticker: string;
  returnsByMonth: Map<string, number>; // "YYYY-MM" -> returnPct
  earliestMonth: Date;
  latestMonth: Date;
}

interface ComputeInput {
  contributionAmount: number;
  monthlyIncome: number;
  monthlyExpense: number;
  startMonth: Date; // first-of-month UTC
  endMonth: Date; // first-of-month UTC, inclusive
  allocations: AllocationInput[];
}

/** Pure, unit-testable core of the engine — steps month by month from
 * startMonth to endMonth (inclusive), blending each allocated fund's
 * return by its portfolio weight. */
export function computePlanMonths(input: ComputeInput): PlanMonthPoint[] {
  const { contributionAmount, monthlyIncome, monthlyExpense, startMonth, endMonth, allocations } = input;
  const points: PlanMonthPoint[] = [];

  let balance = 0;
  let totalInvested = 0;
  let wallet = 0;

  const totalMonths = (endMonth.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 + (endMonth.getUTCMonth() - startMonth.getUTCMonth()) + 1;

  for (let i = 0; i < totalMonths; i++) {
    const monthDate = addMonths(startMonth, i);
    const key = monthKey(monthDate);

    let blendedRate = 0;
    for (const allocation of allocations) {
      const rate = allocation.returnsByMonth.get(key);
      if (rate === undefined) {
        throw new HttpError(
          500,
          `Fund ${allocation.ticker} is missing return data for ${key} — should not happen within its own [min,max] coverage.`
        );
      }
      blendedRate += (allocation.weightPct / 100) * rate;
    }

    balance = (balance + contributionAmount) * (1 + blendedRate);
    totalInvested += contributionAmount;
    wallet += monthlyIncome - monthlyExpense - contributionAmount;

    points.push({
      monthDate: monthDate.toISOString().slice(0, 10),
      portfolioReturnPct: round2To6(blendedRate),
      contribution: round2(contributionAmount),
      endingBalance: round2(balance),
      totalInvested: round2(totalInvested),
      walletBalance: round2(wallet),
    });
  }

  return points;
}

function round2To6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

interface LoadedPortfolio {
  id: string;
  name: string;
  userId: string | null;
  allocations: AllocationInput[];
}

async function loadPortfolioForPlan(portfolioId: string, requestingUserId: string): Promise<LoadedPortfolio> {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    include: {
      allocations: {
        include: { fund: { include: { monthlyReturns: { orderBy: { monthDate: "asc" } } } } },
      },
    },
  });
  if (!portfolio) {
    throw new HttpError(404, "Portfolio not found");
  }
  if (portfolio.userId && portfolio.userId !== requestingUserId) {
    throw new HttpError(404, "Portfolio not found");
  }
  if (portfolio.allocations.length === 0) {
    throw new HttpError(400, "Portfolio has no fund allocations");
  }

  const emptyFund = portfolio.allocations.find((a) => a.fund.monthlyReturns.length === 0);
  if (emptyFund) {
    throw new HttpError(422, `Fund ${emptyFund.fund.ticker} has no monthly return data available yet`);
  }

  const allocations: AllocationInput[] = portfolio.allocations.map((a) => {
    const returns = a.fund.monthlyReturns;
    const returnsByMonth = new Map<string, number>();
    for (const r of returns) returnsByMonth.set(monthKey(r.monthDate), Number(r.returnPct));
    return {
      weightPct: Number(a.weightPct),
      ticker: a.fund.ticker,
      returnsByMonth,
      earliestMonth: toUtcMonthStart(returns[0].monthDate),
      latestMonth: toUtcMonthStart(returns[returns.length - 1].monthDate),
    };
  });

  return { id: portfolio.id, name: portfolio.name, userId: portfolio.userId, allocations };
}

class PlanService {
  async startPlan(userId: string, input: unknown): Promise<PlanSummary> {
    const parsed = startPlanSchema.parse(input);

    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(404, "Set up your profile before starting a plan");
    }
    if (parsed.contributionAmount > Number(profile.monthlyIncome)) {
      throw new HttpError(
        422,
        `Contribution amount cannot exceed your monthly income ($${Number(profile.monthlyIncome).toFixed(2)})`
      );
    }

    const portfolio = await loadPortfolioForPlan(parsed.portfolioId, userId);

    const requestedStart = toUtcMonthStart(new Date(parsed.startMonth));
    if (Number.isNaN(requestedStart.getTime())) {
      throw new HttpError(400, "Invalid startMonth");
    }

    // Every allocated fund must have data for the whole span — the plan's
    // valid start range is bounded by the *latest* of each fund's earliest
    // month, and the *earliest* of each fund's latest month.
    const earliestAllowed = portfolio.allocations.reduce(
      (max, a) => (a.earliestMonth > max ? a.earliestMonth : max),
      portfolio.allocations[0].earliestMonth
    );
    const latestAvailable = portfolio.allocations.reduce(
      (min, a) => (a.latestMonth < min ? a.latestMonth : min),
      portfolio.allocations[0].latestMonth
    );
    const currentMonth = toUtcMonthStart(new Date());
    const endMonth = latestAvailable < currentMonth ? latestAvailable : currentMonth;

    if (requestedStart < earliestAllowed) {
      throw new HttpError(
        422,
        `Choose a start month on or after ${earliestAllowed.toISOString().slice(0, 7)} — that's the earliest month every fund in this portfolio has real data for.`
      );
    }
    if (requestedStart > endMonth) {
      throw new HttpError(422, `Choose a start month on or before ${endMonth.toISOString().slice(0, 7)}.`);
    }

    const months = computePlanMonths({
      contributionAmount: parsed.contributionAmount,
      monthlyIncome: Number(profile.monthlyIncome),
      monthlyExpense: Number(profile.monthlyExpense),
      startMonth: requestedStart,
      endMonth,
      allocations: portfolio.allocations,
    });

    // One active plan at a time — replace, don't accumulate.
    await prisma.plan.deleteMany({ where: { userId } });

    const plan = await prisma.plan.create({
      data: {
        userId,
        portfolioId: portfolio.id,
        contributionAmount: parsed.contributionAmount,
        startMonth: requestedStart,
        months: {
          createMany: {
            data: months.map((m) => ({
              monthDate: new Date(m.monthDate + "T00:00:00.000Z"),
              portfolioReturnPct: m.portfolioReturnPct,
              contribution: m.contribution,
              endingBalance: m.endingBalance,
              totalInvested: m.totalInvested,
              walletBalance: m.walletBalance,
            })),
          },
        },
      },
    });

    return toSummary(plan.id, portfolio.id, portfolio.name, parsed.contributionAmount, requestedStart, months);
  }

  /** Recompute-on-read: re-derives every month fresh, upserts, and returns
   * the current active plan (or null if the user has none). */
  async getActivePlan(userId: string): Promise<PlanSummary | null> {
    const existing = await prisma.plan.findUnique({ where: { userId } });
    if (!existing) return null;

    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) return null; // shouldn't happen — a plan requires a profile to have been created

    const portfolio = await loadPortfolioForPlan(existing.portfolioId, userId);
    const startMonth = toUtcMonthStart(existing.startMonth);

    const latestAvailable = portfolio.allocations.reduce(
      (min, a) => (a.latestMonth < min ? a.latestMonth : min),
      portfolio.allocations[0].latestMonth
    );
    const currentMonth = toUtcMonthStart(new Date());
    const endMonth = latestAvailable < currentMonth ? latestAvailable : currentMonth;

    const months =
      startMonth > endMonth
        ? []
        : computePlanMonths({
            contributionAmount: Number(existing.contributionAmount),
            monthlyIncome: Number(profile.monthlyIncome),
            monthlyExpense: Number(profile.monthlyExpense),
            startMonth,
            endMonth,
            allocations: portfolio.allocations,
          });

    // Per-row upsert, not delete-then-recreate: months only ever grow
    // between reads (startMonth is fixed, endMonth only moves forward as
    // real time / newly-ingested data advances), so there's never a stale
    // row to prune. This also makes concurrent reads safe — the mobile
    // dashboard fires /dashboard/summary and /dashboard/growth in
    // parallel, both of which land here; a delete+recreate transaction
    // raced on the (planId, monthDate) unique constraint (P2002) when two
    // such calls interleaved, upserts don't.
    await Promise.all(
      months.map((m) =>
        prisma.planMonth.upsert({
          where: { planId_monthDate: { planId: existing.id, monthDate: new Date(m.monthDate + "T00:00:00.000Z") } },
          create: {
            planId: existing.id,
            monthDate: new Date(m.monthDate + "T00:00:00.000Z"),
            portfolioReturnPct: m.portfolioReturnPct,
            contribution: m.contribution,
            endingBalance: m.endingBalance,
            totalInvested: m.totalInvested,
            walletBalance: m.walletBalance,
          },
          update: {
            portfolioReturnPct: m.portfolioReturnPct,
            contribution: m.contribution,
            endingBalance: m.endingBalance,
            totalInvested: m.totalInvested,
            walletBalance: m.walletBalance,
          },
        })
      )
    );

    return toSummary(
      existing.id,
      portfolio.id,
      portfolio.name,
      Number(existing.contributionAmount),
      startMonth,
      months
    );
  }
}

function toSummary(
  planId: string,
  portfolioId: string,
  portfolioName: string,
  contributionAmount: number,
  startMonth: Date,
  months: PlanMonthPoint[]
): PlanSummary {
  const last = months[months.length - 1];
  return {
    planId,
    portfolioId,
    portfolioName,
    contributionAmount: round2(contributionAmount),
    startMonth: startMonth.toISOString().slice(0, 10),
    finalValue: last?.endingBalance ?? 0,
    totalContributed: last?.totalInvested ?? 0,
    growth: round2((last?.endingBalance ?? 0) - (last?.totalInvested ?? 0)),
    walletBalance: last?.walletBalance ?? 0,
    months,
  };
}

export const planService = new PlanService();
