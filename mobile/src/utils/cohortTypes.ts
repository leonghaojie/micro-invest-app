/** Shapes of the peer comparison cards, as GET /peers/cohort returns them (DECISIONS.md #18). */
export type MetricKey = "investmentRate" | "consistency" | "diversification" | "return" | "returnPerRisk";

export interface Card {
  key: MetricKey;
  label: string;
  unit: "%" | "score" | "ratio";
  status: "ok" | "unavailable" | "withheld";
  /** Why a card has no figures, in words for the user. */
  message?: string;
  you?: number;
  median?: number;
  p25?: number;
  p75?: number;
  percentile?: number;
  topPct?: number;
  cohortSize?: number;
  basis: string;
  filter: string | null;
  relaxations: string[];
  /** A caveat on how to read the figures. */
  note?: string;
  detail?: { label: string; you: number; median: number; unit: "%" };
}
