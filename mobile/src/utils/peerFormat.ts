/**
 * Metric labels and number formatting for the peer dashboard
 * (DECISIONS.md #9), shared by the screen and the chart components.
 */
export type PeerMetric = "value" | "returnPct" | "contributionRatePct" | "savingsRatePct" | "emergencyBuffer";

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
  /** Full-precision formatting, for text. */
  format: (v: number) => string;
  /** Compact formatting, for chart axes. */
  axis: (v: number) => string;
}[] = [
  { key: "value", label: "Value", format: formatCurrency, axis: formatCompactCurrency },
  { key: "returnPct", label: "Return", format: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%` },
  { key: "contributionRatePct", label: "Contribution rate", format: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%` },
  { key: "savingsRatePct", label: "Savings rate", format: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%` },
  { key: "emergencyBuffer", label: "Emergency buffer", format: (v) => `${v.toFixed(1)}x`, axis: (v) => `${v.toFixed(1)}x` },
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
