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
import { planService } from "./plan.service";

export interface DashboardSummary {
  hasPlan: boolean;
  latestPlan: {
    planId: string;
    portfolioName: string;
    startMonth: string;
    finalValue: number;
    totalContributed: number;
    growth: number;
    walletBalance: number;
  } | null;
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
    return {
      hasPlan: true,
      latestPlan: {
        planId: plan.planId,
        portfolioName: plan.portfolioName,
        startMonth: plan.startMonth,
        finalValue: plan.finalValue,
        totalContributed: plan.totalContributed,
        growth: plan.growth,
        walletBalance: plan.walletBalance,
      },
    };
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
