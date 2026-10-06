/**
 * Loads investors as engine members (utils/peerCohort.ts), shared by the anonymous cohort
 * comparison and the friends ranking (DECISIONS.md #22) so both work out the same measures
 * from the same data. A member is anyone with a profile who has invested (holds something or
 * has a month with money in); an account holding only cash is not an investor yet.
 */
import { prisma } from "../config/prisma";
import { contributionConsistency, tradeMonthAfter } from "../utils/ledger";
import { Member, Risk, trailingMonths } from "../utils/peerCohort";
import { oldestLatestMonth } from "./fundDataUpdate.service";

const BENCHMARK_TICKERS = ["VT", "AGG"];
/** What the securities were worth at the latest month on record, if the account held anything then. */
function latestHeldValue(months: { hasPosition: boolean; endingBalance: unknown }[]): number | undefined {
  const latest = months[0];
  return latest && latest.hasPosition ? Number(latest.endingBalance) : undefined;
}

export const WINDOW_MONTHS = 12;

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export interface LoadedMembers {
  /** The latest month the data runs to: the end of every comparison window. */
  asOf: string;
  members: Member[];
  /** How many of the members are simulated. */
  simulated: number;
  /** Monthly returns of the benchmark's funds over the comparison window. */
  fundReturns: Record<string, Record<string, number>>;
}

/**
 * Everyone who has invested, or only `userIds` when given. null when there is no fund data yet.
 * Reads the stored (derived) rows; callers bring an account up to date first if they need to.
 */
export async function loadMembers(userIds?: string[]): Promise<LoadedMembers | null> {
  const asOf = await oldestLatestMonth();
  if (!asOf) return null;

  const plans = await prisma.plan.findMany({
    ...(userIds ? { where: { userId: { in: userIds } } } : {}),
    include: {
      user: { select: { isSynthetic: true, profile: true } },
      holdings: { select: { value: true, fund: { select: { assetClass: true, ticker: true, name: true } } } },
      months: { orderBy: { monthDate: "desc" }, take: WINDOW_MONTHS },
    },
  });

  // Months in which each account bought something, for contribution consistency.
  const buyRows = await prisma.ledgerEntry.groupBy({
    by: ["planId", "month"],
    where: { side: "BUY", ...(userIds ? { plan: { userId: { in: userIds } } } : {}) },
  });
  const buyMonthsByPlan = new Map<string, string[]>();
  for (const r of buyRows) {
    const list = buyMonthsByPlan.get(r.planId) ?? [];
    list.push(monthKey(r.month));
    buyMonthsByPlan.set(r.planId, list);
  }
  const tradeMonth = tradeMonthAfter(asOf);

  const members: Member[] = [];
  let simulated = 0;
  for (const plan of plans) {
    const p = plan.user.profile;
    if (!p) continue;
    if (plan.holdings.length === 0 && !plan.months.some((m) => m.hasPosition)) continue;
    const heldTotal = plan.holdings.reduce((sum, h) => sum + Number(h.value), 0);
    if (plan.user.isSynthetic) simulated += 1;
    members.push({
      id: plan.userId,
      age: p.age,
      income: Number(p.monthlyIncome),
      expense: Number(p.monthlyExpense),
      risk: p.riskLevel as Risk,
      contribution: Number(plan.contributionAmount),
      // At the latest month-end, like the Explore view's value; what was bought since shows once its data arrives.
      value: latestHeldValue(plan.months),
      consistencyPct: contributionConsistency(buyMonthsByPlan.get(plan.id) ?? [], tradeMonth)?.pct ?? null,
      holdings: plan.holdings.map((h) => ({ assetClass: h.fund.assetClass, weight: heldTotal > 0 ? Number(h.value) / heldTotal : 0, ticker: h.fund.ticker, name: h.fund.name })),
      // Months with nothing invested have no return and are left out.
      monthlyReturns: Object.fromEntries(plan.months.filter((m) => m.hasPosition).map((m) => [monthKey(m.monthDate), Number(m.portfolioReturnPct)])),
    });
  }

  const first = trailingMonths(asOf, WINDOW_MONTHS)[0];
  const benchmarkRows = await prisma.fundMonthlyReturn.findMany({
    where: { fund: { ticker: { in: BENCHMARK_TICKERS } }, monthDate: { gte: new Date(`${first}-01T00:00:00.000Z`) } },
    select: { monthDate: true, returnPct: true, fund: { select: { ticker: true } } },
  });
  const fundReturns: Record<string, Record<string, number>> = {};
  for (const row of benchmarkRows) (fundReturns[row.fund.ticker] ??= {})[monthKey(row.monthDate)] = Number(row.returnPct);

  return { asOf, members, simulated, fundReturns };
}
