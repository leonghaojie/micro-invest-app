/**
 * PeerCohortService (DECISIONS.md #18): the default peer comparison. Loads the members
 * (everyone with a profile and a plan, real or simulated), hands them to the cohort
 * engine (utils/peerCohort.ts), and returns only aggregates: a cohort label, a group
 * description, medians and percentiles, never another person's record (NFR-03).
 *
 * Members are accounts that have invested (DECISIONS.md #19).
 *
 * Unlike the older peer views (peerInsights.service.ts), which aggregate in Postgres,
 * the nearest-neighbour step is computed here in application memory: it needs every
 * member's normalised features at once. That is cheap at this scale (hundreds of
 * members; a request reads one row per plan plus up to 12 months each) and is
 * documented as the point to move to a precomputed feature table if the population
 * ever grows by orders of magnitude.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { contributionConsistency, tradeMonthAfter } from "../utils/ledger";
import { buildCohortReport, buildPopulation, CohortReport, Member, Risk, trailingMonths } from "../utils/peerCohort";
import { oldestLatestMonth } from "./fundDataUpdate.service";
import { planService } from "./plan.service";

export type CohortResponse =
  | { status: "no-profile" | "no-plan" | "no-data" }
  | {
      status: "ok";
      /** The latest month the data runs to: the end of every comparison window. */
      asOf: string;
      population: { size: number; /** Percent of the population that is simulated. */ simulatedPct: number };
      report: CohortReport;
    };

const BENCHMARK_TICKERS = ["VT", "AGG"];
const WINDOW_MONTHS = 12;

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

class PeerCohortService {
  async getCohort(userId: string): Promise<CohortResponse> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) return { status: "no-profile" };

    // Recompute the user's own plan first, so their figures are as of the latest data month.
    const myPlan = await planService.getActivePlan(userId);
    if (!myPlan) return { status: "no-plan" };

    const asOf = await oldestLatestMonth();
    if (!asOf) return { status: "no-data" };

    const plans = await prisma.plan.findMany({
      include: {
        user: { select: { isSynthetic: true, profile: true } },
        holdings: { select: { value: true, fund: { select: { assetClass: true } } } },
        months: { orderBy: { monthDate: "desc" }, take: WINDOW_MONTHS },
      },
    });

    // Months in which each account bought something, for contribution consistency.
    const buyRows = await prisma.ledgerEntry.groupBy({ by: ["planId", "month"], where: { side: "BUY" } });
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
      // Only people who have invested are compared (an account with just cash is not an investor yet).
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
        consistencyPct: contributionConsistency(buyMonthsByPlan.get(plan.id) ?? [], tradeMonth)?.pct ?? null,
        holdings: plan.holdings.map((h) => ({ assetClass: h.fund.assetClass, weight: heldTotal > 0 ? Number(h.value) / heldTotal : 0 })),
        // Months with nothing invested have no return and are left out.
        monthlyReturns: Object.fromEntries(plan.months.filter((m) => m.hasPosition).map((m) => [monthKey(m.monthDate), Number(m.portfolioReturnPct)])),
      });
    }

    const me = members.find((m) => m.id === userId);
    if (!me) return { status: "no-plan" };

    // Monthly returns of the benchmark's funds over the comparison window.
    const first = trailingMonths(asOf, WINDOW_MONTHS)[0];
    const benchmarkRows = await prisma.fundMonthlyReturn.findMany({
      where: { fund: { ticker: { in: BENCHMARK_TICKERS } }, monthDate: { gte: new Date(`${first}-01T00:00:00.000Z`) } },
      select: { monthDate: true, returnPct: true, fund: { select: { ticker: true } } },
    });
    const fundReturns: Record<string, Record<string, number>> = {};
    for (const row of benchmarkRows) {
      (fundReturns[row.fund.ticker] ??= {})[monthKey(row.monthDate)] = Number(row.returnPct);
    }

    const report = buildCohortReport(buildPopulation(members), me, { asOf, fundReturns, minGroup: env.minGroupSize });
    return {
      status: "ok",
      asOf,
      population: { size: members.length, simulatedPct: Math.round((simulated / members.length) * 100) },
      report,
    };
  }
}

export const peerCohortService = new PeerCohortService();
