/**
 * InsightService — FR12 (UC-06). Rule-based insight cards from user-vs-peer
 * gaps, with a positive-reinforcement fallback when no meaningful gap is
 * detected (UC-06 alt flow) instead of always nagging about a shortfall.
 *
 * ⚠️ The gap thresholds and card copy below are a placeholder rule set —
 * DECISIONS.md doesn't lock a "meaningful gap" formula the way it does for
 * e.g. ConsistencyScore. What IS exact: the suggested contribution
 * figures. Since the compounding recurrence (simulation.service.ts,
 * DECISIONS.md #1) has no additive term besides contributionAmount each
 * period, finalValue is exactly proportional to contributionAmount for a
 * fixed rate/period count — so
 *   newContribution = currentContribution * (targetValue / currentFinalValue)
 * reaches targetValue exactly, not an approximation.
 */
import { ContributionFrequency } from "@prisma/client";
import { prisma } from "../config/prisma";
import { dashboardService, DashboardBehaviour } from "./dashboard.service";
import { peerBenchmarkService, PeerGroupStats } from "./peerBenchmark.service";
import { peerGroupingService } from "./peerGrouping.service";
import { round2 } from "./simulation.service";

export interface InsightCard {
  id: string;
  tone: "positive" | "neutral" | "suggestion";
  title: string;
  body: string;
  // UC-06's own placeholder text calls this the "Adjust Plan" link back to
  // S-03 — true on cards where acting means running a new simulation.
  showAdjustPlanAction: boolean;
}

interface LatestSimulation {
  finalValue: number;
  contributionAmount: number;
  frequency: ContributionFrequency;
}

async function getLatestSimulation(userId: string): Promise<LatestSimulation | null> {
  const latest = await prisma.simulation.findFirst({
    where: { userId, finalValue: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!latest || latest.finalValue === null) return null;
  return {
    finalValue: Number(latest.finalValue),
    contributionAmount: Number(latest.contributionAmount),
    frequency: latest.frequency,
  };
}

function buildPeerCard(latest: LatestSimulation, stats: PeerGroupStats): InsightCard {
  if (stats.memberCount === 0) {
    return {
      id: "no-peer-data",
      tone: "neutral",
      title: "Not enough peer data yet",
      body: "There aren't enough peers with a similar profile yet to compare against. Check back as more people join.",
      showAdjustPlanAction: false,
    };
  }

  const { finalValue, contributionAmount } = latest;

  if (finalValue < stats.p25) {
    const suggested = round2(contributionAmount * (stats.p50 / finalValue));
    return {
      id: "peer-gap",
      tone: "suggestion",
      title: "You're behind similar peers",
      body: `Your latest simulation reached $${finalValue.toFixed(2)}, below the peer median of $${stats.p50.toFixed(
        2
      )}. Raising your contribution to about $${suggested.toFixed(2)} per period would put you in line with peers like you.`,
      showAdjustPlanAction: true,
    };
  }

  if (finalValue < stats.p50) {
    const suggested = round2(contributionAmount * (stats.p75 / finalValue));
    return {
      id: "peer-in-line",
      tone: "neutral",
      title: "Right around the peer average",
      body: `Your latest simulation reached $${finalValue.toFixed(2)}, close to the peer median of $${stats.p50.toFixed(
        2
      )}. Raising your contribution to about $${suggested.toFixed(2)} per period could move you into the top quarter of peers like you.`,
      showAdjustPlanAction: true,
    };
  }

  return {
    id: "peer-ahead",
    tone: "positive",
    title: "Ahead of similar peers",
    body: `Your latest simulation reached $${finalValue.toFixed(2)}, ahead of the peer median of $${stats.p50.toFixed(
      2
    )}. Keep it up!`,
    showAdjustPlanAction: false,
  };
}

function buildConsistencyCard(behaviour: DashboardBehaviour): InsightCard {
  return {
    id: "consistency",
    tone: "suggestion",
    title: "Build a more consistent habit",
    body: `You've been active in ${behaviour.monthsWithActivity} of ${behaviour.monthsSinceFirstRun} months since your first simulation. Running one every month builds a stronger track record.`,
    showAdjustPlanAction: true,
  };
}

class InsightService {
  async generate(userId: string): Promise<InsightCard[]> {
    const latest = await getLatestSimulation(userId);

    if (!latest) {
      return [
        {
          id: "no-simulation",
          tone: "neutral",
          title: "Run your first simulation",
          body: "Once you've run a simulation, you'll get personalized insights comparing you to peers with a similar plan.",
          showAdjustPlanAction: true,
        },
      ];
    }

    const cards: InsightCard[] = [];

    // A user profile is required for peer grouping (assignPeerGroup 404s
    // without one), but by this point they've already gone through
    // Profile Setup to run a simulation at all — this guards the
    // theoretical gap rather than an expected path.
    try {
      const group = await peerGroupingService.assignPeerGroup(userId);
      const stats = await peerBenchmarkService.computePeerGroupStats(group);
      cards.push(buildPeerCard(latest, stats));
    } catch {
      // no profile — skip the peer card rather than fail the whole screen
    }

    const behaviour = await dashboardService.getBehaviour(userId);
    if (behaviour.monthsSinceFirstRun > 1 && behaviour.consistencyScore < 100) {
      cards.push(buildConsistencyCard(behaviour));
    }

    return cards.slice(0, 3);
  }
}

export const insightService = new InsightService();
