/**
 * InsightService — FR12 (UC-06), rewritten for DECISIONS.md #2's
 * income-range peer grouping and the new Savings Rate / Emergency Buffer
 * metrics (25 Aug 2026). The old ConsistencyScore card is gone along with
 * dashboard.service.ts's getBehaviour (see that file's header) — UC-06
 * step 3's example gap ("e.g. below peer median ConsistencyScore") no
 * longer has a metric to attach to, but the "e.g." always implied it
 * wasn't the only gap type, and the Data Dictionary's percentile fields
 * still support the same rule shape for the three metrics that do exist
 * now: portfolio value, Savings Rate, Emergency Buffer.
 */
import { peerBenchmarkService, PercentileStats } from "./peerBenchmark.service";
import { peerGroupingService } from "./peerGrouping.service";
import { planService, round2 } from "./plan.service";

export interface InsightCard {
  id: string;
  tone: "positive" | "neutral" | "suggestion";
  title: string;
  body: string;
  showAdjustPlanAction: boolean;
}

function buildValueCard(finalValue: number, contributionAmount: number, stats: PercentileStats, memberCount: number): InsightCard {
  if (memberCount === 0) {
    return {
      id: "no-peer-data",
      tone: "neutral",
      title: "Not enough peer data yet",
      body: "There aren't enough peers with a similar income yet to compare against. Check back as more people join.",
      showAdjustPlanAction: false,
    };
  }

  if (finalValue < stats.p25) {
    const suggested = round2(contributionAmount * (stats.p50 / Math.max(finalValue, 0.01)));
    return {
      id: "value-gap",
      tone: "suggestion",
      title: "You're behind similar peers",
      body: `Your plan is worth $${finalValue.toFixed(2)}, below the peer median of $${stats.p50.toFixed(2)}. Raising your monthly contribution to about $${suggested.toFixed(2)} would put you in line with peers earning like you.`,
      showAdjustPlanAction: true,
    };
  }

  if (finalValue < stats.p50) {
    return {
      id: "value-in-line",
      tone: "neutral",
      title: "Right around the peer average",
      body: `Your plan is worth $${finalValue.toFixed(2)}, close to the peer median of $${stats.p50.toFixed(2)}.`,
      showAdjustPlanAction: true,
    };
  }

  return {
    id: "value-ahead",
    tone: "positive",
    title: "Ahead of similar peers",
    body: `Your plan is worth $${finalValue.toFixed(2)}, ahead of the peer median of $${stats.p50.toFixed(2)}. Keep it up!`,
    showAdjustPlanAction: false,
  };
}

function buildSavingsRateCard(mine: number, stats: PercentileStats): InsightCard | null {
  if (mine >= stats.p50) return null; // only surface this when it's a real gap, mirrors the old ConsistencyScore trigger
  return {
    id: "savings-rate-gap",
    tone: "suggestion",
    title: "Below peer savings rate",
    body: `Your Savings Rate is ${mine.toFixed(0)}%, below the peer median of ${stats.p50.toFixed(0)}%. Trimming monthly expenses (or raising income) would close the gap.`,
    showAdjustPlanAction: false,
  };
}

function buildEmergencyBufferCard(mine: number, stats: PercentileStats): InsightCard | null {
  if (mine >= stats.p50) return null;
  return {
    id: "emergency-buffer-gap",
    tone: "suggestion",
    title: "Thin emergency buffer",
    body: `Your wallet covers about ${mine.toFixed(1)}x your monthly expenses, below the peer median of ${stats.p50.toFixed(1)}x. Building this up protects you before you invest more.`,
    showAdjustPlanAction: false,
  };
}

class InsightService {
  async generate(userId: string): Promise<InsightCard[]> {
    const plan = await planService.getActivePlan(userId);

    if (!plan || plan.holdings.length === 0) {
      return [
        {
          id: "no-plan",
          tone: "neutral",
          title: "Make your first investment",
          body: "Once you've bought a fund, you'll get personalized insights comparing you to peers with a similar income.",
          showAdjustPlanAction: true,
        },
      ];
    }

    const cards: InsightCard[] = [];

    try {
      const [group, myMetrics] = await Promise.all([
        peerGroupingService.assignPeerGroup(userId),
        peerBenchmarkService.getMyMetrics(userId),
      ]);
      const stats = await peerBenchmarkService.computeStats(userId, group);

      cards.push(buildValueCard(plan.finalValue, plan.contributionAmount, stats.value, stats.memberCount));

      if (stats.memberCount > 0) {
        const savingsCard = buildSavingsRateCard(myMetrics.savingsRatePct, stats.savingsRatePct);
        if (savingsCard) cards.push(savingsCard);

        if (myMetrics.emergencyBuffer !== null) {
          const bufferCard = buildEmergencyBufferCard(myMetrics.emergencyBuffer, stats.emergencyBuffer);
          if (bufferCard) cards.push(bufferCard);
        }
      }
    } catch {
      // no profile — skip peer-relative cards rather than fail the whole screen
    }

    return cards.slice(0, 3);
  }
}

export const insightService = new InsightService();
