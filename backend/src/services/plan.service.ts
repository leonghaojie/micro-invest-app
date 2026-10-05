/**
 * PlanService — the user's investment account, as one summary (DECISIONS.md #19).
 *
 * This used to run one fixed plan (one portfolio, one monthly amount, one start month).
 * The account is now described by a ledger of cash credits, buys and sells (ledger.service.ts
 * and utils/ledger.ts); this file keeps the old entry point, `getActivePlan`, so the
 * dashboard, friends, insights and peer views keep reading one summary. It returns the same
 * kind of figures as before (monthly snapshots, value, amount put in, cash) plus what is
 * held now.
 *
 * "Recompute on read": every call catches the account up to the current trade month
 * (credits, due recurring buys), replays the facts, stores the derived rows and returns
 * them, so new fund data and new months show up without a cron job. NFR-04: deterministic,
 * every input is stored data.
 */
import { refreshAccount } from "./ledger.service";
import { averageMonthlyBuy, round2 } from "../utils/ledger";

export { round2 };

export interface PlanMonthPoint {
  monthDate: string; // YYYY-MM-01
  /** The month's time-weighted return as a fraction. Not a real return when `hasPosition` is false. */
  portfolioReturnPct: number;
  /** Net money put in during the month: buys minus sells (the old fixed "contribution"). */
  contribution: number;
  endingBalance: number;
  /** Cumulative buys minus sells. */
  totalInvested: number;
  /** Cash after the month. */
  walletBalance: number;
  /** False when nothing was held during the month. */
  hasPosition: boolean;
}

export interface PlanHoldingSummary {
  fundId: string;
  /** Worth now; this month's trades are held at cost until the month's data arrives. */
  value: number;
  costBasis: number;
}

export interface PlanSummary {
  planId: string;
  /** The month trades are made in now, "YYYY-MM". */
  tradeMonth: string;
  /** The latest month with data, "YYYY-MM". */
  latestDataMonth: string;
  /** Typical monthly purchase: the average bought per month over the last <= 12 months. */
  contributionAmount: number;
  /** The month of the first buy (or, with none yet, the month the account opened), YYYY-MM-01. */
  startMonth: string;
  /** What is held now (sum of holdings). */
  finalValue: number;
  /** Buys minus sells so far. */
  totalContributed: number;
  /** Total profit: value minus net invested. */
  growth: number;
  /** Cash now. */
  walletBalance: number;
  /** One snapshot per month with data, oldest first. */
  months: PlanMonthPoint[];
  holdings: PlanHoldingSummary[];
}

class PlanService {
  /**
   * The user's account, caught up and recomputed. Null only when they have no profile yet
   * (an account needs one, for its monthly cash). Pass `advance: false` to read another
   * person's account without changing it (friends, peers).
   */
  async getActivePlan(userId: string, opts: { advance?: boolean } = {}): Promise<PlanSummary | null> {
    const result = await refreshAccount(userId, opts);
    if (!result) return null;
    const { planId, clock, state } = result;

    const finalValue = round2(state.holdings.reduce((s, h) => s + h.value, 0));
    const firstMonth = state.firstBuyMonth ?? state.facts.credits.map((c) => c.month).sort()[0] ?? clock.tradeMonth;
    return {
      planId,
      tradeMonth: clock.tradeMonth,
      latestDataMonth: clock.latestDataMonth,
      contributionAmount: averageMonthlyBuy(state.facts.entries, clock.tradeMonth),
      startMonth: `${firstMonth}-01`,
      finalValue,
      totalContributed: state.netInvested,
      growth: round2(finalValue - state.netInvested),
      walletBalance: state.cash,
      months: state.points.map((p) => ({
        monthDate: `${p.month}-01`,
        portfolioReturnPct: Math.round(p.portfolioReturn * 1_000_000) / 1_000_000,
        contribution: p.netFlow,
        endingBalance: p.endingValue,
        totalInvested: p.totalInvested,
        walletBalance: p.cash,
        hasPosition: p.hasPosition,
      })),
      holdings: state.holdings.map((h) => ({ fundId: h.fundId, value: h.value, costBasis: h.costBasis })),
    };
  }
}

export const planService = new PlanService();
