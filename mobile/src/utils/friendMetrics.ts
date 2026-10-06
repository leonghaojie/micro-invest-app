/**
 * The measures friends are compared on (DECISIONS.md #22, #24): the cohort comparison's measures
 * except the portfolio's value, which is never shown against a name. Shared by the rankings
 * (FriendsComparison) and the one-to-one comparison (FriendCompareScreen) so both use the same
 * names and units.
 */
import type { MetricKey } from "./cohortTypes";

export type FriendMetricKey = Exclude<MetricKey, "value">;

export interface FriendMetric {
  key: FriendMetricKey;
  label: string;
  chip: string;
  format: (v: number) => string;
}

export const FRIEND_METRICS: FriendMetric[] = [
  { key: "return", label: "Portfolio return", chip: "Return", format: (v) => `${v.toFixed(1)}%` },
  { key: "monthlyReturn", label: "Monthly portfolio return", chip: "Monthly return", format: (v) => `${v.toFixed(1)}%` },
  { key: "investmentRate", label: "Monthly investment rate", chip: "Investment rate", format: (v) => `${v.toFixed(1)}%` },
  { key: "consistency", label: "Contribution consistency", chip: "Consistency", format: (v) => `${v.toFixed(1)}%` },
  { key: "diversification", label: "Diversification score", chip: "Diversification", format: (v) => `${Math.round(v)}/100` },
];

export function friendMetric(key: FriendMetricKey): FriendMetric {
  return FRIEND_METRICS.find((m) => m.key === key)!;
}
