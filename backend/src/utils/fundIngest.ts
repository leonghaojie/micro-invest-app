/**
 * Pure helpers for loading monthly fund data (DECISIONS.md #15). No I/O, so the
 * rules that decide what is stored - which months are complete, how a month's
 * return is derived, whether a row is plausible - are testable.
 *
 * Months are "YYYY-MM" strings (UTC). "Complete" means the calendar month has
 * fully ended: in October only data through September is final.
 */

export interface RawRow {
  /** YYYY-MM-DD, the first of the month the bar belongs to (as yfinance labels it) */
  date: string;
  /** Unadjusted month-end close */
  close: number;
  /** Dividends paid in the month */
  dividends: number;
}

export interface DerivedReturn {
  /** "YYYY-MM" */
  month: string;
  monthDate: Date;
  startPrice: number;
  endPrice: number;
  dividendAmount: number;
  /** Fraction, e.g. 0.0125 = 1.25% */
  returnPct: number;
}

/** Bounds for a believable single-month total return. Outside this a row is
 * rejected as a data glitch (a bad tick, an unadjusted split) rather than
 * stored: -60% / +100% in one month would be a historic event for these funds. */
export const MIN_MONTHLY_RETURN = -0.6;
export const MAX_MONTHLY_RETURN = 1.0;

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The most recent month that has fully ended, as of `now`. */
export function lastCompleteMonth(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based; the previous month is index m-1
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}

/** Whole months from `from` to `to` ("YYYY-MM"); negative if `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Drops the final row if it belongs to a month that has not ended: Yahoo
 * always includes an in-progress bar for the month still open, whose close is
 * not final. */
export function dropIncompleteMonth(rows: RawRow[], now: Date): RawRow[] {
  if (rows.length === 0) return rows;
  const last = rows[rows.length - 1];
  return last.date.slice(0, 7) > lastCompleteMonth(now) ? rows.slice(0, -1) : rows;
}

export interface DeriveResult {
  returns: DerivedReturn[];
  /** Rows skipped as implausible, for logging. */
  rejected: { month: string; reason: string }[];
}

/** A month's return is (end close + dividends - previous close) / previous close,
 * so it needs the previous month's row; the first row only supplies a start. */
export function deriveMonthlyReturns(rows: RawRow[], now: Date): DeriveResult {
  const complete = dropIncompleteMonth(rows, now);
  const returns: DerivedReturn[] = [];
  const rejected: DeriveResult["rejected"] = [];

  for (let i = 1; i < complete.length; i++) {
    const prev = complete[i - 1];
    const cur = complete[i];
    const month = cur.date.slice(0, 7);

    if (!(prev.close > 0) || !(cur.close > 0) || !Number.isFinite(cur.close) || !Number.isFinite(cur.dividends) || cur.dividends < 0) {
      rejected.push({ month, reason: "non-positive or non-finite price/dividend" });
      continue;
    }
    const returnPct = (cur.close + cur.dividends - prev.close) / prev.close;
    if (returnPct < MIN_MONTHLY_RETURN || returnPct > MAX_MONTHLY_RETURN) {
      rejected.push({ month, reason: `implausible monthly return ${(returnPct * 100).toFixed(1)}%` });
      continue;
    }
    returns.push({
      month,
      monthDate: new Date(cur.date.slice(0, 7) + "-01T00:00:00.000Z"),
      startPrice: prev.close,
      endPrice: cur.close,
      dividendAmount: cur.dividends,
      returnPct,
    });
  }
  return { returns, rejected };
}

/** Months missing between the first and last of a sorted list (history is
 * expected to be gap-free; the fund detail screen relies on it). */
export function findGaps(months: string[]): string[] {
  const gaps: string[] = [];
  for (let i = 1; i < months.length; i++) {
    for (let step = 1; step < monthsBetween(months[i - 1], months[i]); step++) {
      const [y, m] = months[i - 1].split("-").map(Number);
      const idx = y * 12 + (m - 1) + step;
      gaps.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
    }
  }
  return gaps;
}
