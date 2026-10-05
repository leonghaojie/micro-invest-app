/**
 * DashboardService — FR08, rewritten for DECISIONS.md #1 third amendment
 * (25 Aug 2026): reads off the user's one active Plan (plan.service.ts)
 * instead of a history of Simulation runs — there's still no cross-run
 * aggregate to invent, but now there's also no "latest run" ambiguity to
 * resolve, since there's only ever one plan. NFR-01: target <2s load.
 *
 * ConsistencyScore/getBehaviour is removed — it measured how many distinct
 * months the user *chose* to run a simulation in, which has no meaning
 * once contributions are an automatic monthly backtest rather than
 * user-initiated runs (DECISIONS.md new metrics entry).
 */
import { prisma } from "../config/prisma";
import { PlanSummary, planService, round2 } from "./plan.service";

/** One fund in the user's plan, valued at its weight of the portfolio. */
export interface DashboardHolding {
  fundId: string;
  ticker: string;
  name: string;
  assetClass: string;
  currency: string;
  weightPct: number;
  /** weight x the portfolio's current value. The plan rebalances to its weights every
   * month (that is how the engine blends returns), so this is the fund's share, not a
   * separately tracked position - there is deliberately no per-fund profit figure. */
  value: number;
}

export interface DashboardPlan {
  planId: string;
  portfolioName: string;
  /** Preset portfolios are public names; a custom one is the user's own. */
  portfolioIsPreset: boolean;
  startMonth: string;
  contributionAmount: number;
  monthsRunning: number;
  /** Current value of the invested money ("securities value"). */
  finalValue: number;
  /** Everything put in so far (the cost). */
  totalContributed: number;
  /** Unrealised profit or loss: value - contributed. */
  growth: number;
  growthPct: number | null;
  /** Cash left over after contributing. */
  walletBalance: number;
  /** Securities value plus cash. */
  totalAssets: number;
  /** What the latest month added or took away, after that month's contribution. */
  lastMonth: { month: string; pnl: number; pnlPct: number | null } | null;
  holdings: DashboardHolding[];
}

export interface DashboardSummary {
  hasPlan: boolean;
  latestPlan: DashboardPlan | null;
}

interface PortfolioForSummary {
  isPreset: boolean;
  allocations: { fundId: string; weightPct: unknown; fund: { ticker: string; name: string; assetClass: string; currency: string } }[];
}

/** Pure. Turns the active plan (and its portfolio's funds) into the dashboard figures. */
export function buildDashboardPlan(plan: PlanSummary, portfolio: PortfolioForSummary | null): DashboardPlan {
  const months = plan.months;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];

  // V_t = (V_{t-1} + C_t)(1 + R_t): the month's profit is V_t - V_{t-1} - C_t.
  let lastMonth: DashboardPlan["lastMonth"] = null;
  if (last) {
    const before = prev ? prev.endingBalance : 0;
    const pnl = round2(last.endingBalance - before - last.contribution);
    const base = before + last.contribution;
    lastMonth = { month: last.monthDate.slice(0, 7), pnl, pnlPct: base > 0 ? round2((pnl / base) * 100) : null };
  }

  const holdings = (portfolio?.allocations ?? [])
    .map((a) => {
      const weightPct = Number(a.weightPct);
      return {
        fundId: a.fundId,
        ticker: a.fund.ticker,
        name: a.fund.name,
        assetClass: a.fund.assetClass,
        currency: a.fund.currency,
        weightPct,
        value: round2((weightPct / 100) * plan.finalValue),
      };
    })
    .sort((x, y) => y.weightPct - x.weightPct || x.ticker.localeCompare(y.ticker));

  return {
    planId: plan.planId,
    portfolioName: plan.portfolioName,
    portfolioIsPreset: portfolio?.isPreset ?? false,
    startMonth: plan.startMonth,
    contributionAmount: plan.contributionAmount,
    monthsRunning: months.length,
    finalValue: plan.finalValue,
    totalContributed: plan.totalContributed,
    growth: plan.growth,
    growthPct: plan.totalContributed > 0 ? round2((plan.growth / plan.totalContributed) * 100) : null,
    walletBalance: plan.walletBalance,
    totalAssets: round2(plan.finalValue + plan.walletBalance),
    lastMonth,
    holdings,
  };
}

export interface GrowthPoint {
  monthDate: string;
  portfolioValue: number;
  walletBalance: number;
}

export interface DashboardGrowth {
  planId: string | null;
  portfolioName: string | null;
  points: GrowthPoint[];
}

class DashboardService {
  async getSummary(userId: string): Promise<DashboardSummary> {
    const plan = await planService.getActivePlan(userId);
    if (!plan) {
      return { hasPlan: false, latestPlan: null };
    }
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: plan.portfolioId },
      include: { allocations: { include: { fund: true } } },
    });
    return { hasPlan: true, latestPlan: buildDashboardPlan(plan, portfolio) };
  }

  async getGrowth(userId: string): Promise<DashboardGrowth> {
    const plan = await planService.getActivePlan(userId);
    if (!plan) {
      return { planId: null, portfolioName: null, points: [] };
    }
    return {
      planId: plan.planId,
      portfolioName: plan.portfolioName,
      points: plan.months.map((m) => ({
        monthDate: m.monthDate,
        portfolioValue: m.endingBalance,
        walletBalance: m.walletBalance,
      })),
    };
  }
}

export const dashboardService = new DashboardService();
