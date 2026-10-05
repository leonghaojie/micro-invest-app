/**
 * The ledger engine (DECISIONS.md #19). Pure: no database, no clock.
 *
 * A user's money is described by facts: monthly cash credits and fund buys and sells.
 * `replay` folds those facts, month by month, against the funds' monthly returns into
 * everything the app shows: holdings, value, cash, net invested, and one snapshot per
 * month with data.
 *
 * Conventions (the same as the old fixed-plan engine, so return arithmetic is unchanged):
 *   - every trade in month t is made at the START of t, priced at the close of t-1, so it
 *     earns month t's return once t's data exists;
 *   - month t's flows are applied before its return:
 *       V_f,t = (V_f,t-1 + buys_f,t - sells_f,t) x (1 + r_f,t)
 *   - the TRADE MONTH is the month after the latest month with data. Its trades are held
 *     at cost until its data arrives, so it has no snapshot yet.
 * Holdings drift with the market; nothing is rebalanced.
 */

export interface LedgerEntry {
  /** The trade month, "YYYY-MM". */
  month: string;
  side: "BUY" | "SELL";
  fundId: string;
  /** Dollars, positive. */
  amount: number;
}

export interface Credit {
  month: string;
  amount: number;
}

/** fundId -> "YYYY-MM" -> monthly return as a fraction. */
export type FundReturns = Record<string, Record<string, number>>;

export interface ReplayPoint {
  month: string;
  /** The month's time-weighted return as a fraction; 0 when nothing was invested (see hasPosition). */
  portfolioReturn: number;
  /** False when nothing was held during the month, so `portfolioReturn` is not a real return. */
  hasPosition: boolean;
  /** Buys minus sells in the month. */
  netFlow: number;
  /** Portfolio value at the end of the month. */
  endingValue: number;
  /** Cumulative buys minus sells through the month. */
  totalInvested: number;
  /** Cash after the month's credit and trades. */
  cash: number;
}

export interface Holding {
  fundId: string;
  value: number;
  /** Average-cost basis of what is still held. */
  costBasis: number;
}

export interface ReplayResult {
  points: ReplayPoint[];
  /** Holdings now, including the trade month's trades at cost. Funds with nothing held are left out. */
  holdings: Holding[];
  /** Cash now, including the trade month. */
  cash: number;
  /** Cumulative buys minus sells, now. */
  netInvested: number;
  /** The first month with a buy, or null. */
  firstBuyMonth: string | null;
}

// ── Months ──────────────────────────────────────────────────────────────

const monthIndex = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
};
const keyOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export function addMonths(key: string, n: number): string {
  return keyOf(monthIndex(key) + n);
}

/** Whole months from a to b (negative if b is earlier). */
export function monthsBetween(a: string, b: string): number {
  return monthIndex(b) - monthIndex(a);
}

/** The trade month: the month after the latest month with data. */
export function tradeMonthAfter(latestDataMonth: string): string {
  return addMonths(latestDataMonth, 1);
}

/** "YYYY-MM" for each month from `from` to `to`, inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(keyOf(i));
  return out;
}

// ── Money ───────────────────────────────────────────────────────────────

export const round2 = (v: number) => Math.round(v * 100) / 100;
const toCents = (v: number) => Math.round(v * 100);

/** What is left of a month's income after expenses; never negative (there is no debt in the app). */
export function spareIncome(income: number, expense: number): number {
  return Math.max(0, round2(income - expense));
}

/**
 * Splits `amount` across funds by weight (percent) into whole cents that add up to exactly
 * `amount`. Leftover cents go to the heaviest funds first (ties by fund id), so the split
 * is deterministic. Funds that would get nothing are left out.
 */
export function splitByWeights(amount: number, weights: { fundId: string; weightPct: number }[]): { fundId: string; amount: number }[] {
  const total = weights.reduce((s, w) => s + w.weightPct, 0);
  if (weights.length === 0 || total <= 0) return [];
  const cents = toCents(amount);
  const shares = weights.map((w) => ({ fundId: w.fundId, weightPct: w.weightPct, cents: Math.floor((cents * w.weightPct) / total) }));
  let left = cents - shares.reduce((s, x) => s + x.cents, 0);
  const order = [...shares].sort((a, b) => b.weightPct - a.weightPct || (a.fundId < b.fundId ? -1 : 1));
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) order[i].cents += 1;
  return shares.filter((s) => s.cents > 0).map((s) => ({ fundId: s.fundId, amount: s.cents / 100 }));
}

// ── Replay ──────────────────────────────────────────────────────────────

interface FundState {
  /** Value at the end of the last month processed. */
  value: number;
  cost: number;
}

export interface ReplayInput {
  credits: Credit[];
  /** Within a month, buys are applied before sells, so a sell can use what was bought that month. */
  entries: LedgerEntry[];
  returns: FundReturns;
  /** The latest month with data. Months after it have no return. */
  latestDataMonth: string;
}

export function replay({ credits, entries, returns, latestDataMonth }: ReplayInput): ReplayResult {
  const tradeMonth = tradeMonthAfter(latestDataMonth);
  const months = [...credits.map((c) => c.month), ...entries.map((e) => e.month)].sort();
  if (months.length === 0) return { points: [], holdings: [], cash: 0, netInvested: 0, firstBuyMonth: null };
  const first = months[0];
  const last = months[months.length - 1] > tradeMonth ? months[months.length - 1] : tradeMonth;

  const creditByMonth = new Map<string, number>();
  for (const c of credits) creditByMonth.set(c.month, (creditByMonth.get(c.month) ?? 0) + toCents(c.amount));
  const entriesByMonth = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const list = entriesByMonth.get(e.month) ?? [];
    list.push(e);
    entriesByMonth.set(e.month, list);
  }

  const funds = new Map<string, FundState>();
  const state = (fundId: string): FundState => {
    let s = funds.get(fundId);
    if (!s) funds.set(fundId, (s = { value: 0, cost: 0 }));
    return s;
  };

  let cashCents = 0;
  let investedCents = 0;
  let firstBuyMonth: string | null = null;
  const points: ReplayPoint[] = [];

  for (const month of monthRange(first, last)) {
    cashCents += creditByMonth.get(month) ?? 0;
    let netFlowCents = 0;

    // Flows first, at last month's close.
    const monthEntries = entriesByMonth.get(month) ?? [];
    for (const e of [...monthEntries.filter((x) => x.side === "BUY"), ...monthEntries.filter((x) => x.side === "SELL")]) {
      const s = state(e.fundId);
      const cents = toCents(e.amount);
      if (e.side === "BUY") {
        s.value += cents / 100;
        s.cost += cents / 100;
        cashCents -= cents;
        netFlowCents += cents;
        if (firstBuyMonth === null) firstBuyMonth = month;
      } else {
        if (cents / 100 > s.value + 0.005) throw new Error(`Ledger sells more of fund ${e.fundId} than is held in ${month}`);
        const fraction = s.value > 0 ? Math.min(1, cents / 100 / s.value) : 1;
        s.cost -= s.cost * fraction;
        s.value -= cents / 100;
        cashCents += cents;
        netFlowCents -= cents;
      }
    }
    investedCents += netFlowCents;

    if (month > latestDataMonth) continue; // the trade month: held at cost, no return yet

    let base = 0;
    let end = 0;
    for (const [fundId, s] of funds) {
      if (s.value <= 0.005) {
        s.value = 0; // nothing (but rounding dust) held
        s.cost = 0;
        continue;
      }
      const r = returns[fundId]?.[month];
      if (r === undefined) throw new Error(`Fund ${fundId} has no return for ${month}, but it is held`);
      base += s.value;
      s.value *= 1 + r;
      end += s.value;
    }
    points.push({
      month,
      portfolioReturn: base > 0 ? end / base - 1 : 0,
      hasPosition: base > 0,
      netFlow: netFlowCents / 100,
      endingValue: round2(end),
      totalInvested: investedCents / 100,
      cash: cashCents / 100,
    });
  }

  const holdings: Holding[] = [...funds.entries()]
    .filter(([, s]) => s.value > 0.005)
    .map(([fundId, s]) => ({ fundId, value: round2(s.value), costBasis: round2(s.cost) }))
    .sort((a, b) => b.value - a.value || (a.fundId < b.fundId ? -1 : 1));

  return { points, holdings, cash: cashCents / 100, netInvested: investedCents / 100, firstBuyMonth };
}

/**
 * Average dollars bought per month over the last (up to) 12 months, counting from the first
 * buy and including the trade month. Used as the "typical monthly investment".
 */
export function averageMonthlyBuy(entries: LedgerEntry[], tradeMonth: string): number {
  const buys = entries.filter((e) => e.side === "BUY");
  if (buys.length === 0) return 0;
  const firstBuy = buys.map((b) => b.month).sort()[0];
  const from = monthsBetween(addMonths(tradeMonth, -11), firstBuy) > 0 ? firstBuy : addMonths(tradeMonth, -11);
  const window = monthRange(from, tradeMonth);
  const total = buys.filter((b) => b.month >= from && b.month <= tradeMonth).reduce((s, b) => s + toCents(b.amount), 0);
  return round2(total / 100 / window.length);
}
