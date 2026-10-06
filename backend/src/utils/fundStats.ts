/**
 * Descriptive history and statistics for one fund (DECISIONS.md #14), derived
 * purely from its stored monthly rows. No I/O here, so the maths is testable.
 *
 * What is computed, over a chosen range of whole months:
 *  - growth of 100: 100 compounded by each month's total return (price change
 *    plus dividends), i.e. dividends are treated as reinvested;
 *  - total return, annualised return (only with at least 12 months), annualised
 *    volatility (sample std-dev of monthly returns x sqrt(12), at least 12
 *    months), maximum drawdown (worst peak-to-trough fall of the growth path),
 *    best / worst month, share of months that were positive;
 *  - independent of the range: the last 36 monthly returns, calendar-year
 *    returns, and the trailing-12-month dividend yield.
 *
 * Everything is in Singapore dollars (DECISIONS.md #29): a fund listed in another currency is converted at
 * month-end rates when it is loaded, so its return includes the currency move. Past figures only
 * describe history - nothing here is a forecast or a recommendation.
 *
 * All "...Pct" values are percentages (1.25 = 1.25%), rounded to 2 dp.
 */

export const RANGE_MONTHS = { "1y": 12, "3y": 36, "5y": 60, "10y": 120, max: Number.POSITIVE_INFINITY } as const;
export type RangeKey = keyof typeof RANGE_MONTHS;
export const RANGE_KEYS = Object.keys(RANGE_MONTHS) as RangeKey[];

/** One stored month. `returnPct` is a fraction (0.0125 = 1.25%), as in the database. */
export interface MonthlyRow {
  /** "YYYY-MM" */
  month: string;
  endPrice: number;
  dividend: number;
  returnPct: number;
}

export interface SeriesPoint {
  /** "YYYY-MM": the point is the END of this month. The first point is the
   * end of the month before the range, i.e. the start, where growth is 100. */
  month: string;
  growth: number;
}

export interface MonthReturn {
  month: string;
  returnPct: number;
}

export interface CalendarYear {
  year: number;
  returnPct: number;
  /** True when the fund has fewer than 12 months of data in that year. */
  partial: boolean;
}

export interface FundStats {
  totalReturnPct: number;
  /** null with fewer than 12 months in the range. */
  annualizedReturnPct: number | null;
  /** null with fewer than 12 months in the range. */
  volatilityPct: number | null;
  /** Zero or negative: the worst fall from a previous high. */
  maxDrawdownPct: number;
  bestMonth: MonthReturn;
  worstMonth: MonthReturn;
  positiveMonthsPct: number;
}

export interface FundHistory {
  /** The range actually used: the one asked for, or "max" if the fund is younger than it. */
  range: RangeKey;
  /** Months actually used. */
  months: number;
  startMonth: string;
  endMonth: string;
  /** Ranges the fund has enough history for ("max" is always included). */
  availableRanges: RangeKey[];
  series: SeriesPoint[];
  stats: FundStats;
  /** The last 36 months (or fewer), oldest first - not affected by `range`. */
  recentMonths: MonthReturn[];
  /** Most recent first, up to 10 calendar years - not affected by `range`. */
  calendarYears: CalendarYear[];
  /** Dividends paid in the last 12 months / latest price. null with < 12 months of data. */
  trailingYieldPct: number | null;
  latestPrice: number;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** "2026-01" -> "2025-12" */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function isRangeKey(value: string): value is RangeKey {
  return (RANGE_KEYS as string[]).includes(value);
}

/** Pure. `rows` must be sorted oldest first and gap-free (the ingest guarantees
 * this); throws if there is no data at all. */
export function buildFundHistory(rows: MonthlyRow[], range: RangeKey): FundHistory {
  if (rows.length === 0) throw new Error("buildFundHistory needs at least one month of data");

  // A range longer than the fund's history means 'everything we have'.
  const effectiveRange: RangeKey = RANGE_MONTHS[range] > rows.length ? "max" : range;
  const wanted = RANGE_MONTHS[effectiveRange];
  const used = rows.slice(Math.max(0, rows.length - (Number.isFinite(wanted) ? wanted : rows.length)));
  const n = used.length;

  // Growth of 100, with the start (growth 100) as the first point.
  const series: SeriesPoint[] = [{ month: previousMonth(used[0].month), growth: 100 }];
  let growth = 100;
  for (const row of used) {
    growth *= 1 + row.returnPct;
    series.push({ month: row.month, growth: round2(growth) });
  }

  // Max drawdown over the unrounded path (start included).
  let level = 100;
  let peak = 100;
  let maxDrawdown = 0;
  for (const row of used) {
    level *= 1 + row.returnPct;
    peak = Math.max(peak, level);
    maxDrawdown = Math.min(maxDrawdown, level / peak - 1);
  }

  const returns = used.map((r) => r.returnPct);
  const totalReturn = level / 100 - 1;
  const annualized = n >= 12 ? Math.pow(level / 100, 12 / n) - 1 : null;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = n >= 2 ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1) : 0;
  const volatility = n >= 12 ? Math.sqrt(variance) * Math.sqrt(12) : null;

  const best = used.reduce((a, b) => (b.returnPct > a.returnPct ? b : a));
  const worst = used.reduce((a, b) => (b.returnPct < a.returnPct ? b : a));
  const toMonthReturn = (r: MonthlyRow): MonthReturn => ({ month: r.month, returnPct: round2(r.returnPct * 100) });

  const stats: FundStats = {
    totalReturnPct: round2(totalReturn * 100),
    annualizedReturnPct: annualized === null ? null : round2(annualized * 100),
    volatilityPct: volatility === null ? null : round2(volatility * 100),
    maxDrawdownPct: round2(maxDrawdown * 100),
    bestMonth: toMonthReturn(best),
    worstMonth: toMonthReturn(worst),
    positiveMonthsPct: round2((returns.filter((r) => r > 0).length / n) * 100),
  };

  // Calendar-year returns across the fund's whole history.
  const byYear = new Map<number, MonthlyRow[]>();
  for (const row of rows) {
    const year = Number(row.month.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }
  const calendarYears: CalendarYear[] = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 10)
    .map(([year, yearRows]) => ({
      year,
      returnPct: round2((yearRows.reduce((acc, r) => acc * (1 + r.returnPct), 1) - 1) * 100),
      partial: yearRows.length < 12,
    }));

  const latest = rows[rows.length - 1];
  const last12 = rows.slice(-12);
  const trailingYield = rows.length >= 12 && latest.endPrice > 0 ? last12.reduce((a, r) => a + r.dividend, 0) / latest.endPrice : null;

  return {
    range: effectiveRange,
    months: n,
    startMonth: used[0].month,
    endMonth: used[n - 1].month,
    availableRanges: RANGE_KEYS.filter((k) => k === "max" || RANGE_MONTHS[k] <= rows.length),
    series,
    stats,
    recentMonths: rows.slice(-36).map(toMonthReturn),
    calendarYears,
    trailingYieldPct: trailingYield === null ? null : round2(trailingYield * 100),
    latestPrice: latest.endPrice,
  };
}
