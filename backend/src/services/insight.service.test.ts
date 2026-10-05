/**
 * InsightService unit tests — FR12/UC-06, rewritten for DECISIONS.md #2's
 * income-range peer grouping and the new Savings Rate / Emergency Buffer
 * metrics (25 Aug 2026). Mocks the already-tested plan/peer services
 * directly since InsightService only orchestrates them.
 */
import { insightService } from "./insight.service";
import { peerBenchmarkService } from "./peerBenchmark.service";
import { peerGroupingService } from "./peerGrouping.service";
import { planService } from "./plan.service";

jest.mock("./peerGrouping.service", () => ({
  peerGroupingService: { assignPeerGroup: jest.fn() },
}));
jest.mock("./peerBenchmark.service", () => ({
  peerBenchmarkService: { computeStats: jest.fn(), getMyMetrics: jest.fn() },
}));
jest.mock("./plan.service", () => ({
  planService: { getActivePlan: jest.fn() },
  round2: (v: number) => Math.round(v * 100) / 100,
}));

const mockedGrouping = peerGroupingService as unknown as { assignPeerGroup: jest.Mock };
const mockedBenchmark = peerBenchmarkService as unknown as { computeStats: jest.Mock; getMyMetrics: jest.Mock };
const mockedPlan = planService as unknown as { getActivePlan: jest.Mock };

const GROUP = { bandPct: 10, lo: 3600, hi: 4400, memberCount: 12 };

function mockActivePlan(finalValue: number, contributionAmount = 50) {
  mockedPlan.getActivePlan.mockResolvedValue({
    planId: "plan-1",
    tradeMonth: "2026-10",
    latestDataMonth: "2026-09",
    holdings: [{ fundId: "f1", value: finalValue, costBasis: finalValue }],
    contributionAmount,
    startMonth: "2026-01-01",
    finalValue,
    totalContributed: contributionAmount * 4,
    growth: finalValue - contributionAmount * 4,
    walletBalance: 100,
    months: [],
  });
}

function mockStats(overrides: Partial<{ memberCount: number; value: object; savingsRatePct: object; emergencyBuffer: object }> = {}) {
  mockedBenchmark.computeStats.mockResolvedValue({
    memberCount: 10,
    value: { p25: 100, p50: 200, p75: 300 },
    savingsRatePct: { p25: 10, p50: 30, p75: 50 },
    emergencyBuffer: { p25: 0.5, p50: 1.5, p75: 3 },
    ...overrides,
  });
}

function mockMyMetrics(overrides: Partial<{ finalValue: number | null; savingsRatePct: number; emergencyBuffer: number | null }> = {}) {
  mockedBenchmark.getMyMetrics.mockResolvedValue({
    finalValue: 250,
    savingsRatePct: 40,
    emergencyBuffer: 2,
    ...overrides,
  });
}

describe("InsightService", () => {
  beforeEach(() => {
    mockedGrouping.assignPeerGroup.mockResolvedValue(GROUP);
  });

  it("returns a single no-plan card when the user has no profile (so no account)", async () => {
    mockedPlan.getActivePlan.mockResolvedValue(null);

    const cards = await insightService.generate("user-1");

    expect(cards).toEqual([expect.objectContaining({ id: "no-plan" })]);
  });

  it("returns the same card for an account that holds nothing yet (cash alone is not an investment)", async () => {
    mockActivePlan(0);
    mockedPlan.getActivePlan.mockResolvedValue({ ...(await mockedPlan.getActivePlan()), holdings: [], finalValue: 0 });

    const cards = await insightService.generate("user-1");

    expect(cards).toEqual([expect.objectContaining({ id: "no-plan", title: "Make your first investment" })]);
  });

  it("returns a no-peer-data card when the peer group has no members yet", async () => {
    mockActivePlan(100);
    mockStats({ memberCount: 0, value: { p25: 0, p50: 0, p75: 0 } });
    mockMyMetrics();

    const cards = await insightService.generate("user-1");

    expect(cards[0]).toEqual(expect.objectContaining({ id: "no-peer-data", tone: "neutral" }));
  });

  it("flags a value gap below the 25th percentile", async () => {
    mockActivePlan(80, 50);
    mockStats();
    mockMyMetrics();

    const cards = await insightService.generate("user-1");

    expect(cards[0].id).toBe("value-gap");
    expect(cards[0].tone).toBe("suggestion");
    expect(cards[0].showAdjustPlanAction).toBe(true);
  });

  it("flags in-line-with-peers between p25 and p50", async () => {
    mockActivePlan(150, 50);
    mockStats();
    mockMyMetrics();

    const cards = await insightService.generate("user-1");

    expect(cards[0].id).toBe("value-in-line");
  });

  it("gives positive reinforcement with no suggestion when ahead of the median", async () => {
    mockActivePlan(250, 50);
    mockStats();
    mockMyMetrics({ savingsRatePct: 40, emergencyBuffer: 2 }); // both above their peer medians (30, 1.5) — no gap cards

    const cards = await insightService.generate("user-1");

    expect(cards[0]).toEqual(expect.objectContaining({ id: "value-ahead", tone: "positive", showAdjustPlanAction: false }));
    expect(cards).toHaveLength(1);
  });

  it("skips peer-relative cards (without crashing) when the user has no profile yet", async () => {
    mockActivePlan(100);
    mockedGrouping.assignPeerGroup.mockRejectedValue(Object.assign(new Error("no profile"), { statusCode: 404 }));

    const cards = await insightService.generate("user-1");

    expect(cards).toEqual([]);
  });

  it("adds a Savings Rate gap card when below the peer median", async () => {
    mockActivePlan(250, 50);
    mockStats();
    mockMyMetrics({ savingsRatePct: 15, emergencyBuffer: 2 }); // below savings p50 (30), above buffer p50 (1.5)

    const cards = await insightService.generate("user-1");

    expect(cards.map((c) => c.id)).toContain("savings-rate-gap");
    expect(cards.map((c) => c.id)).not.toContain("emergency-buffer-gap");
  });

  it("adds an Emergency Buffer gap card when below the peer median", async () => {
    mockActivePlan(250, 50);
    mockStats();
    mockMyMetrics({ savingsRatePct: 40, emergencyBuffer: 0.8 }); // above savings p50, below buffer p50 (1.5)

    const cards = await insightService.generate("user-1");

    expect(cards.map((c) => c.id)).toContain("emergency-buffer-gap");
  });

  it("omits the Emergency Buffer card when the user has no wallet data yet", async () => {
    mockActivePlan(250, 50);
    mockStats();
    mockMyMetrics({ savingsRatePct: 40, emergencyBuffer: null });

    const cards = await insightService.generate("user-1");

    expect(cards.map((c) => c.id)).not.toContain("emergency-buffer-gap");
  });

  it("never returns more than 3 cards", async () => {
    mockActivePlan(80, 50); // triggers value-gap
    mockStats();
    mockMyMetrics({ savingsRatePct: 15, emergencyBuffer: 0.8 }); // triggers both gap cards too

    const cards = await insightService.generate("user-1");

    expect(cards.length).toBeLessThanOrEqual(3);
  });
});
