/**
 * Metric labels and number formatting for the peer dashboard
 * (DECISIONS.md #9), shared by the screen and the chart components.
 */
export type PeerMetric = "value" | "returnPct" | "monthlyReturnPct" | "investmentRatePct" | "consistencyPct" | "diversificationScore" | "savingsRatePct";

export function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short form for chart axes: $1.2k, $950. */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (abs >= 1000) return `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(value)}`;
}

export const METRICS: {
  key: PeerMetric;
  label: string;
  /** One line on what the measure is. */
  what: string;
  /** Full-precision formatting, for text. */
  format: (v: number) => string;
  /** Compact formatting, for chart axes. */
  axis: (v: number) => string;
}[] = [
  { key: "value", label: "Value", what: "What the securities you hold are worth now.", format: formatCurrency, axis: formatCompactCurrency },
  { key: "returnPct", label: "Return", what: "How much your portfolio has grown or shrunk compared with the money you put in.", format: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%` },
  { key: "monthlyReturnPct", label: "Monthly return", what: "How much your portfolio grew or shrank in the latest month.", format: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%` },
  { key: "investmentRatePct", label: "Investment rate", what: "How much of your income you put into investments each month, on average.", format: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%` },
  { key: "consistencyPct", label: "Consistency", what: "The share of recent months, from your first purchase, in which you bought something.", format: (v) => `${v.toFixed(0)}%`, axis: (v) => `${Math.round(v)}%` },
  { key: "diversificationScore", label: "Diversification", what: "How widely your money is spread across kinds of assets and funds, from 0 to 100.", format: (v) => `${Math.round(v)}/100`, axis: (v) => `${Math.round(v)}` },
  { key: "savingsRatePct", label: "Savings rate", what: "The share of your income left after expenses, from your profile.", format: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%` },
];

export function metricMeta(key: PeerMetric) {
  return METRICS.find((m) => m.key === key)!;
}

/** 62 -> "62nd", 11 -> "11th", 1 -> "1st". */
export function ordinal(n: number): string {
  const rounded = Math.round(n);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}
