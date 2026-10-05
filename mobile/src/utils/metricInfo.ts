/**
 * Plain-language explanations of the five peer comparison measures, shown when a row of the
 * table is opened (DECISIONS.md #20). Written for someone who has never seen the words
 * "volatility" or "diversification": what it is, how it is worked out, and what a higher number
 * does and does not mean. Nothing here tells the user what to do.
 */
import type { Card, MetricKey } from "./cohortTypes";

export interface MetricInfo {
  /** One line: what this measures. */
  what: string;
  /** How the number is worked out. */
  how: string;
  /** What a higher (or lower) number means, and what it does not. */
  meaning: string;
}

export const METRIC_INFO: Record<MetricKey, MetricInfo> = {
  investmentRate: {
    what: "How much of your income you put into investments each month.",
    how: "Your average monthly purchases over the last 12 months (or since you started), divided by your monthly income.",
    meaning: "A higher figure means a larger share of your income goes into investing. It does not say whether that share suits your situation.",
  },
  consistency: {
    what: "How regularly you invest.",
    how: "The share of the last 12 months, counting from your first purchase, in which you bought something. A month where a monthly buy was skipped for lack of cash counts as a month without a purchase. The current month only counts once you have bought in it. It appears once at least 3 months can be counted.",
    meaning: "100% means you bought in every month counted. A lower figure means some months had no purchase.",
  },
  diversification: {
    what: "How widely your money is spread across different investments.",
    how: "A score from 0 to 100 that combines how evenly your money is spread across kinds of assets (60%) and across individual funds (40%). Holding a single fund scores 0, even a broad one, because we look at what you hold, not what is inside each fund.",
    meaning: "A higher score means your money is spread across more kinds of investments. It is not a measure of how risky your portfolio is or how well it has done.",
  },
  return: {
    what: "How much your portfolio has grown or shrunk.",
    how: "Your total return over the same period as the headline (up to 12 months): each month's return is compounded together, so adding or withdrawing money does not distort it.",
    meaning: "Positive means your portfolio grew, negative that it shrank. It is compared with investors who took the same level of risk, because a higher-risk portfolio is expected to swing more.",
  },
  returnPerRisk: {
    what: "How much return you got for the ups and downs you went through.",
    how: "Your annualised return divided by your annualised volatility, which is how much your monthly returns bounce around. It needs at least 6 months of history.",
    meaning: "A higher number means more return for each unit of ups and downs. A negative number means the portfolio lost money overall.",
  },
};

/** "Top 12%" for the upper half; below the median, the share of peers you are above. */
export function positionText(percentile: number, topPct: number): string {
  if (percentile >= 50) return `Top ${topPct}%`;
  return percentile <= 0 ? "Lowest" : `Above ${percentile}%`;
}

/** A figure in the unit of its measure. */
export function formatMetric(card: Pick<Card, "unit">, v: number): string {
  if (card.unit === "score") return `${Math.round(v)}/100`;
  if (card.unit === "ratio") return v.toFixed(2);
  return `${v.toFixed(1)}%`;
}

/** One sentence on where the user's own figure sits, from the card's numbers. */
export function describeResult(card: Card): string | null {
  if (card.status !== "ok" || card.you === undefined || card.median === undefined || card.p25 === undefined || card.p75 === undefined || card.percentile === undefined || card.topPct === undefined) return null;
  const where =
    card.percentile >= 50 ? `You are in the top ${card.topPct}% of these investors.` : `You are above about ${card.percentile}% of these investors.`;
  return `Your figure is ${formatMetric(card, card.you)}. The median is ${formatMetric(card, card.median)}, and the middle half of investors are between ${formatMetric(card, card.p25)} and ${formatMetric(card, card.p75)}. ${where}`;
}
