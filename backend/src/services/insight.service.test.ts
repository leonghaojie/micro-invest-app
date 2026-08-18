/**
 * InsightService unit tests — FR12/UC-06. Mocks the already-tested peer/
 * dashboard services directly (rather than their underlying Prisma calls)
 * since InsightService only orchestrates them; mocks prisma.simulation
 * directly for the one query InsightService makes itself.
 */
import { prisma } from "../config/prisma";
import { dashboardService } from "./dashboard.service";
import { insightService } from "./insight.service";
import { peerBenchmarkService } from "./peerBenchmark.service";
import { peerGroupingService } from "./peerGrouping.service";

jest.mock("../config/prisma", () => ({
  prisma: { simulation: { findFirst: jest.fn() } },
}));
jest.mock("./peerGrouping.service", () => ({
  peerGroupingService: { assignPeerGroup: jest.fn() },
}));
jest.mock("./peerBenchmark.service", () => ({
  peerBenchmarkService: { computePeerGroupStats: jest.fn() },
}));
jest.mock("./dashboard.service", () => ({
  dashboardService: { getBehaviour: jest.fn() },
}));

const mockedPrisma = prisma as unknown as { simulation: { findFirst: jest.Mock } };
const mockedGrouping = peerGroupingService as unknown as { assignPeerGroup: jest.Mock };
const mockedBenchmark = peerBenchmarkService as unknown as { computePeerGroupStats: jest.Mock };
const mockedDashboard = dashboardService as unknown as { getBehaviour: jest.Mock };

const GROUP = { tier: "FULL" as const, riskLevel: "MEDIUM" as const, budgetBand: "B2" as const, goalType: "HABIT" as const };
const STEADY_BEHAVIOUR = { consistencyScore: 100, monthsWithActivity: 1, monthsSinceFirstRun: 1 };

function mockLatestSimulation(finalValue: number, contributionAmount: number) {
  mockedPrisma.simulation.findFirst.mockResolvedValue({
    finalValue: String(finalValue),
    contributionAmount: String(contributionAmount),
    frequency: "MONTHLY",
  });
}

describe("InsightService", () => {
  beforeEach(() => {
    mockedGrouping.assignPeerGroup.mockResolvedValue(GROUP);
    mockedDashboard.getBehaviour.mockResolvedValue(STEADY_BEHAVIOUR);
  });

  it("returns a single no-simulation card when the user hasn't run one", async () => {
    mockedPrisma.simulation.findFirst.mockResolvedValue(null);

    const cards = await insightService.generate("user-1");

    expect(cards).toEqual([expect.objectContaining({ id: "no-simulation" })]);
  });

  it("returns a no-peer-data card when the peer group has no members yet", async () => {
    mockLatestSimulation(100, 50);
    mockedBenchmark.computePeerGroupStats.mockResolvedValue({ p25: 0, p50: 0, p75: 0, memberCount: 0 });

    const cards = await insightService.generate("user-1");

    expect(cards[0]).toEqual(expect.objectContaining({ id: "no-peer-data", tone: "neutral" }));
  });

  it("flags a gap and computes the exact contribution to reach the peer median", async () => {
    mockLatestSimulation(80, 50);
    mockedBenchmark.computePeerGroupStats.mockResolvedValue({ p25: 100, p50: 200, p75: 300, memberCount: 10 });

    const cards = await insightService.generate("user-1");

    expect(cards[0].id).toBe("peer-gap");
    expect(cards[0].tone).toBe("suggestion");
    // 50 * (200 / 80) = 125.00 — exact by proportionality of the
    // compounding recurrence, not an approximation.
    expect(cards[0].body).toContain("125.00");
    expect(cards[0].showAdjustPlanAction).toBe(true);
  });

  it("flags in-line-with-peers and suggests reaching the 75th percentile", async () => {
    mockLatestSimulation(150, 50);
    mockedBenchmark.computePeerGroupStats.mockResolvedValue({ p25: 100, p50: 200, p75: 300, memberCount: 10 });

    const cards = await insightService.generate("user-1");

    expect(cards[0].id).toBe("peer-in-line");
    // 50 * (300 / 150) = 100.00
    expect(cards[0].body).toContain("100.00");
  });

  it("gives positive reinforcement with no suggestion when ahead of the median", async () => {
    mockLatestSimulation(250, 50);
    mockedBenchmark.computePeerGroupStats.mockResolvedValue({ p25: 100, p50: 200, p75: 300, memberCount: 10 });

    const cards = await insightService.generate("user-1");

    expect(cards[0]).toEqual(expect.objectContaining({ id: "peer-ahead", tone: "positive", showAdjustPlanAction: false }));
  });

  it("skips the peer card (without crashing) when the user has no profile yet", async () => {
    mockLatestSimulation(100, 50);
    mockedGrouping.assignPeerGroup.mockRejectedValue(Object.assign(new Error("no profile"), { statusCode: 404 }));

    const cards = await insightService.generate("user-1");

    expect(cards.find((c) => c.id.startsWith("peer"))).toBeUndefined();
  });

  it("adds a consistency card when behaviour is inconsistent past the first month", async () => {
    mockLatestSimulation(250, 50);
    mockedBenchmark.computePeerGroupStats.mockResolvedValue({ p25: 100, p50: 200, p75: 300, memberCount: 10 });
    mockedDashboard.getBehaviour.mockResolvedValue({ consistencyScore: 50, monthsWithActivity: 1, monthsSinceFirstRun: 2 });

    const cards = await insightService.generate("user-1");

    expect(cards.map((c) => c.id)).toContain("consistency");
  });

  it("omits the consistency card for a cold-start user (one month in, already 100%)", async () => {
    mockLatestSimulation(250, 50);
    mockedBenchmark.computePeerGroupStats.mockResolvedValue({ p25: 100, p50: 200, p75: 300, memberCount: 10 });
    // STEADY_BEHAVIOUR from beforeEach: consistencyScore 100, monthsSinceFirstRun 1.

    const cards = await insightService.generate("user-1");

    expect(cards.map((c) => c.id)).not.toContain("consistency");
  });

  it("never returns more than 3 cards", async () => {
    mockLatestSimulation(250, 50);
    mockedBenchmark.computePeerGroupStats.mockResolvedValue({ p25: 100, p50: 200, p75: 300, memberCount: 10 });
    mockedDashboard.getBehaviour.mockResolvedValue({ consistencyScore: 50, monthsWithActivity: 1, monthsSinceFirstRun: 2 });

    const cards = await insightService.generate("user-1");

    expect(cards.length).toBeLessThanOrEqual(3);
  });
});
