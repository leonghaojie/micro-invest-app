/**
 * The history of a portfolio, from the history of its funds (DECISIONS.md #28).
 *
 * A portfolio has no prices of its own, so its past is a backtest: each month's return is the
 * weighted average of its funds' returns for that month, as if the weights were restored every
 * month (monthly rebalancing). It only covers the months every fund has data for, so the
 * youngest fund decides how far back it goes. The funds' returns are already in Singapore dollars
 * (DECISIONS.md #29), so a mix of Singapore and US funds blends like for like.
 */
import { MonthlyRow } from "./fundStats";

export interface FundSeries {
  /** Percent of the portfolio, e.g. 40. */
  weightPct: number;
  /** Oldest first and gap-free, as the ingest guarantees. */
  rows: MonthlyRow[];
}

export interface BlendedHistory {
  /** One row per common month, oldest first; endPrice is the growth of 100 and dividend is 0 (the
   * funds' dividends are already inside their total returns). Empty when the funds share no month. */
  rows: MonthlyRow[];
  /** The ticker-free index of the series that starts latest, which limits how far back the history goes (-1 when empty). */
  limitedBy: number;
}

/** Pure. The monthly-rebalanced blend of the funds over the months they all have. */
export function blendFundReturns(funds: FundSeries[]): BlendedHistory {
  if (funds.length === 0 || funds.some((f) => f.rows.length === 0)) return { rows: [], limitedBy: -1 };

  const total = funds.reduce((s, f) => s + f.weightPct, 0);
  const byMonth = funds.map((f) => new Map(f.rows.map((r) => [r.month, r.returnPct])));

  // The months every fund has, in order (the first fund's months, kept if all the others have them).
  const months = funds[0].rows.map((r) => r.month).filter((m) => byMonth.every((map) => map.has(m)));

  let growth = 100;
  const rows: MonthlyRow[] = months.map((month) => {
    const r = funds.reduce((sum, f, i) => sum + (f.weightPct / total) * (byMonth[i].get(month) as number), 0);
    growth *= 1 + r;
    return { month, endPrice: Math.round(growth * 10000) / 10000, dividend: 0, returnPct: r };
  });

  // Which fund's start limits the history: the one whose first month is latest.
  let limitedBy = 0;
  funds.forEach((f, i) => {
    if (f.rows[0].month > funds[limitedBy].rows[0].month) limitedBy = i;
  });
  return { rows, limitedBy };
}
