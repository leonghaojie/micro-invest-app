/**
 * DashboardService — FR08, reshaped for the ledger (DECISIONS.md #19, building on #17):
 * reads the user's account (plan.service.ts) and turns it into the portfolio overview.
 * NFR-01: target <2s load.
 *
 * Holdings are now real positions: each fund has a value, a cost basis (average cost of
 * what is still held) and so its own profit. (Under the old fixed plan the holdings were
 * the portfolio's nominal weights, so a per-fund profit would have been invented.)
 */
import { prisma } from "../config/prisma";
import { PlanSummary, planService, round2 } from "./plan.service";

export interface DashboardHolding {
  fundId: string;
  ticker: string;
  name: string;
  assetClass: string;
  currency: string;
  /** Share of the portfolio's current value, percent. */
  weightPct: number;
  /** Worth now; this month's trades are held at cost until the month's data arrives. */
  value: number;
  /** Average cost of what is still held. */
  costBasis: number;
  /** value - costBasis. */
  profit: number;
  profitPct: number | null;
}

export interface DashboardPlan {
  planId: string;
  /** The month trades are made in now, YYYY-MM. */
  tradeMonth: string;
  /** The latest month with data, YYYY-MM: trades are priced at its close. */
  latestDataMonth: string;
  startMonth: string;
  /** Typical monthly purchase: the average bought per month over the last <= 12 months. */
  contributionAmount: number;
  /** Months with money invested. */
  monthsRunning: number;
  /** Current value of the invested money ("securities value"). */
  finalValue: number;
  /** Net invested: everything bought minus everything sold. */
  totalContributed: number;
  /** Total profit: value minus net invested (it includes what sales have already realised). */
  growth: number;
  growthPct: number | null;
  /** Cash in the account. */
  walletBalance: number;
  /** Securities value plus cash. */
  totalAssets: number;
  /** What the latest month added or took away, after that month's own buys and sells. */
  lastMonth: { month: string; pnl: number; pnlPct: number | null } | null;
  holdings: DashboardHolding[];
}

export interface DashboardSummary {
  /** True once the user has an account (a profile); the cash is shown even before the first buy. */
  hasPlan: boolean;
  /** True once something is held. */
  hasHoldings: boolean;
  latestPlan: DashboardPlan | null;
}

export interface FundMeta {
  id: string;
  ticker: string;
  name: string;
  assetClass: string;
  currency: string;
}

/** Pure. Turns the account (and the funds it holds) into the dashboard figures. */
export function buildDashboardPlan(plan: PlanSummary, funds: FundMeta[]): DashboardPlan {
  const months = plan.months;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];

  // V_t = (V_{t-1} + net flow_t)(1 + R_t): the month's profit is V_t - V_{t-1} - net flow_t.
  let lastMonth: DashboardPlan["lastMonth"] = null;
  if (last && (last.hasPosition || last.contribution !== 0)) {
    const before = prev ? prev.endingBalance : 0;
    const pnl = round2(last.endingBalance - before - last.contribution);
    const base = before + last.contribution;
    lastMonth = { month: last.monthDate.slice(0, 7), pnl, pnlPct: base > 0 ? round2((pnl / base) * 100) : null };
  }

  const byId = new Map(funds.map((f) => [f.id, f]));
  const total = plan.holdings.reduce((s, h) => s + h.value, 0);
  const holdings = plan.holdings
    .map((h): DashboardHolding | null => {
      const f = byId.get(h.fundId);
      if (!f) return null;
      const profit = round2(h.value - h.costBasis);
      return {
        fundId: f.id,
        ticker: f.ticker,
        name: f.name,
        assetClass: f.assetClass,
        currency: f.currency,
        weightPct: total > 0 ? round2((h.value / total) * 100) : 0,
        value: h.value,
        costBasis: h.costBasis,
        profit,
        profitPct: h.costBasis > 0 ? round2((profit / h.costBasis) * 100) : null,
      };
    })
    .filter((h): h is DashboardHolding => h !== null)
    .sort((x, y) => y.value - x.value || x.ticker.localeCompare(y.ticker));

  return {
    planId: plan.planId,
    tradeMonth: plan.tradeMonth,
    latestDataMonth: plan.latestDataMonth,
    startMonth: plan.startMonth,
    contributionAmount: plan.contributionAmount,
    monthsRunning: months.filter((m) => m.hasPosition).length,
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
  points: GrowthPoint[];
}

class DashboardService {
  async getSummary(userId: string): Promise<DashboardSummary> {
    const plan = await planService.getActivePlan(userId);
    if (!plan) {
      return { hasPlan: false, hasHoldings: false, latestPlan: null };
    }
    const funds = plan.holdings.length
      ? await prisma.fund.findMany({ where: { id: { in: plan.holdings.map((h) => h.fundId) } }, select: { id: true, ticker: true, name: true, assetClass: true, currency: true } })
      : [];
    return { hasPlan: true, hasHoldings: plan.holdings.length > 0, latestPlan: buildDashboardPlan(plan, funds) };
  }

  async getGrowth(userId: string): Promise<DashboardGrowth> {
    const plan = await planService.getActivePlan(userId);
    if (!plan) {
      return { planId: null, points: [] };
    }
    // The chart starts when money first went in.
    const firstInvested = plan.months.findIndex((m) => m.hasPosition || m.contribution !== 0);
    const shown = firstInvested === -1 ? [] : plan.months.slice(firstInvested);
    return {
      planId: plan.planId,
      points: shown.map((m) => ({ monthDate: m.monthDate, portfolioValue: m.endingBalance, walletBalance: m.walletBalance })),
    };
  }
}

export const dashboardService = new DashboardService();
