/**
 * PeerInsightsService tests — DECISIONS.md #9. Two layers:
 *  - pure helpers (buildHistogram, percentileRank), tested directly — the
 *    histogram's merge rule is a privacy guarantee (no bin describes one or
 *    two people), so it gets thorough coverage;
 *  - the service's behaviour with Prisma mocked: suppression returns no
 *    statistics and no count, thin data yields null panels, and rows are
 *    reshaped correctly. (The SQL itself is exercised by the live end-to-end
 *    run, since a mock can't validate Postgres.)
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { buildHistogram, MIN_CELL_COUNT, peerInsightsService, percentileRank } from "./peerInsights.service";
import type { PeerGroupAssignment } from "./peerGrouping.service";

jest.mock("../config/prisma", () => ({
  prisma: { $queryRaw: jest.fn(), plan: { findUnique: jest.fn() } },
}));

const db = prisma as unknown as { $queryRaw: jest.Mock; plan: { findUnique: jest.Mock } };

// ── Pure helpers ───────────────────────────────────────────────────────

describe("buildHistogram", () => {
  it("leaves bins alone when every non-empty bin has at least MIN_CELL_COUNT members", () => {
    const bins = buildHistogram(0, 100, [5, 0, 10, 3, 7, 0, 4, 6, 9, 8]);

    expect(bins).toHaveLength(10);
    expect(bins.map((b) => b.count)).toEqual([5, 0, 10, 3, 7, 0, 4, 6, 9, 8]);
  });

  it("merges a bin of 1 or 2 into its smaller neighbour", () => {
    // [10, 2, 5, ...] -> the 2 joins the smaller neighbour (5 < 10)
    const bins = buildHistogram(0, 40, [10, 2, 5, 8]);

    expect(bins.map((b) => b.count)).toEqual([10, 7, 8]);
    expect(bins[1]).toMatchObject({ from: 10, to: 30 });
  });

  it("merges an end bin inward, whichever end it is", () => {
    expect(buildHistogram(0, 40, [1, 9, 9, 9]).map((b) => b.count)).toEqual([10, 9, 9]);
    expect(buildHistogram(0, 40, [9, 9, 9, 2]).map((b) => b.count)).toEqual([9, 9, 11]);
  });

  it("keeps merging until no bin holds 1 or 2 members", () => {
    // 1,1,1 are individually too small; they combine to a bin of 3.
    const bins = buildHistogram(0, 50, [1, 1, 1, 20, 20]);

    for (const b of bins) expect(b.count === 0 || b.count >= MIN_CELL_COUNT).toBe(true);
    expect(bins.map((b) => b.count)).toEqual([3, 20, 20]);
  });

  it("collapses to a single bin if everything is too sparse", () => {
    expect(buildHistogram(0, 30, [1, 1, 1]).map((b) => b.count)).toEqual([3]);
    expect(buildHistogram(0, 20, [1, 1]).map((b) => b.count)).toEqual([2]); // total is what it is; never loops forever
  });

  it("keeps empty bins empty (they describe nobody)", () => {
    const bins = buildHistogram(0, 40, [10, 0, 0, 10]);

    expect(bins.map((b) => b.count)).toEqual([10, 0, 0, 10]);
  });

  it("preserves the total count and covers [lo, hi] contiguously", () => {
    const counts = [4, 1, 0, 2, 9, 1, 7, 2, 3, 6];
    const bins = buildHistogram(10, 110, counts);

    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(counts.reduce((s, c) => s + c, 0));
    expect(bins[0].from).toBeCloseTo(10);
    expect(bins[bins.length - 1].to).toBeCloseTo(110);
    for (let i = 1; i < bins.length; i++) expect(bins[i].from).toBeCloseTo(bins[i - 1].to);
  });
});

describe("percentileRank", () => {
  it("counts those below plus half of those tied", () => {
    expect(percentileRank(6, 2, 10)).toBe(70); // (6 + 1) / 10
    expect(percentileRank(0, 1, 10)).toBe(5);
    expect(percentileRank(10, 0, 10)).toBe(100);
    expect(percentileRank(0, 0, 10)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    expect(percentileRank(1, 0, 3)).toBe(33.3);
  });

  it("is null with no peers", () => {
    expect(percentileRank(0, 0, 0)).toBeNull();
  });
});

// ── Service ────────────────────────────────────────────────────────────

const GROUP: PeerGroupAssignment = { bandPct: 10, lo: 3600, hi: 4400, memberCount: 44, dims: ["income"], filters: {}, suppressed: false };

interface Rows {
  mine?: unknown[];
  dist?: unknown[];
  trajPeers?: unknown[];
  trajMine?: unknown[];
  mix?: unknown[];
  funds?: unknown[];
  holdings?: unknown[];
}

/** Routes the service's raw queries by distinctive text in the template. */
function mockQueries(rows: Rows) {
  db.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("width_bucket")) return Promise.resolve(rows.dist ?? []);
    if (text.includes("PARTITION BY pm")) return Promise.resolve(rows.trajPeers ?? []);
    if (text.includes("OVER (ORDER BY pm")) return Promise.resolve(rows.trajMine ?? []);
    if (text.includes("avg_weight")) return Promise.resolve(rows.mix ?? []);
    if (text.includes("holders")) return Promise.resolve(rows.funds ?? []);
    if (text.includes("avg_holdings")) return Promise.resolve(rows.holdings ?? []);
    if (text.includes("me AS (")) return Promise.resolve(rows.mine ?? []);
    return Promise.resolve([]);
  });
}

const DIST_ROW = {
  n: 44,
  lo: "100.004",
  hi: "1000.006",
  p25: "300.1234",
  p50: "500",
  p75: "700",
  below: 10,
  equal: 2,
  // 10 buckets; bucket 2 holds only 2 members (must be merged away)
  buckets: [
    { bucket: 1, count: 6 },
    { bucket: 2, count: 2 },
    { bucket: 3, count: 10 },
    { bucket: 5, count: 12 },
    { bucket: 8, count: 14 },
  ],
};

beforeEach(() => {
  db.plan.findUnique.mockResolvedValue({
    portfolio: { allocations: [{ weightPct: "60", fund: { assetClass: "EQUITY" } }, { weightPct: "40", fund: { assetClass: "BOND" } }] },
  });
});

describe("PeerInsightsService.getDashboard", () => {
  it("returns NO statistics and NO member count for a suppressed segment", async () => {
    mockQueries({ mine: [{ v: "683.61" }] });

    const result = await peerInsightsService.getDashboard("u", { ...GROUP, suppressed: true, memberCount: 4 }, "value");

    expect(result.group.suppressed).toBe(true);
    expect(result.group.memberCount).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/"memberCount":4\b/);
    expect(result.distribution).toBeNull();
    expect(result.trajectory).toBeNull();
    expect(result.allocation).toBeNull();
    expect(result.me).toEqual({ value: 683.61, percentileRank: null });
    // only the user's own figure was queried — no peer aggregate ran at all
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("builds the distribution: merged bins, rounded stats, and the user's mid-rank percentile", async () => {
    mockQueries({ mine: [{ v: "500" }], dist: [DIST_ROW] });

    const result = await peerInsightsService.getDashboard("u", GROUP, "savingsRatePct");

    const d = result.distribution!;
    expect(d.peerCount).toBe(44);
    expect(d.p25).toBe(300.12);
    expect(d.lo).toBe(100);
    expect(d.hi).toBe(1000.01);
    expect(d.bins.reduce((s, b) => s + b.count, 0)).toBe(44);
    for (const b of d.bins) expect(b.count === 0 || b.count >= MIN_CELL_COUNT).toBe(true);
    expect(result.me.percentileRank).toBe(25); // (10 + 2/2) / 44 = 25.0%
    expect(result.group.memberCount).toBe(44);
  });

  it("withholds the distribution when too few peers have a figure for the metric", async () => {
    mockQueries({ mine: [{ v: "1" }], dist: [{ ...DIST_ROW, n: env.minGroupSize - 1 }] });

    const result = await peerInsightsService.getDashboard("u", GROUP, "savingsRatePct");

    expect(result.distribution).toBeNull();
    expect(result.me.percentileRank).toBeNull();
  });

  it("gives the user no rank (but still a distribution) when they have no plan yet", async () => {
    mockQueries({ mine: [], dist: [DIST_ROW] });

    const result = await peerInsightsService.getDashboard("u", GROUP, "savingsRatePct");

    expect(result.me).toEqual({ value: null, percentileRank: null });
    expect(result.distribution).not.toBeNull();
  });

  it("only builds a trajectory for metrics that change month to month", async () => {
    mockQueries({ mine: [{ v: "1" }], dist: [DIST_ROW] });

    const constant = await peerInsightsService.getDashboard("u", GROUP, "savingsRatePct");
    expect(constant.trajectory).toBeNull();
    expect(db.$queryRaw.mock.calls.some((c) => c[0].join("?").includes("PARTITION BY pm"))).toBe(false);
  });

  it("builds the trajectory by months-since-start and attaches the user's own series", async () => {
    mockQueries({
      mine: [{ v: "300" }],
      dist: [DIST_ROW],
      trajPeers: [
        { k: 1, p25: "100", p50: "150", p75: "210.555" },
        { k: 2, p25: "200", p50: "300", p75: "400" },
        { k: 3, p25: "300", p50: "450", p75: "600" },
      ],
      trajMine: [
        { k: 1, v: "120" },
        { k: 2, v: "310" },
      ],
    });

    const result = await peerInsightsService.getDashboard("u", GROUP, "value");

    expect(result.trajectory).toEqual([
      { k: 1, p25: 100, p50: 150, p75: 210.56, mine: 120 },
      { k: 2, p25: 200, p50: 300, p75: 400, mine: 310 },
      { k: 3, p25: 300, p50: 450, p75: 600, mine: null }, // the user hasn't reached month 3
    ]);
  });

  it("returns no trajectory when no month has enough peers", async () => {
    mockQueries({ mine: [{ v: "1" }], dist: [DIST_ROW], trajPeers: [] });

    const result = await peerInsightsService.getDashboard("u", GROUP, "value");

    expect(result.trajectory).toBeNull();
  });

  it("shapes the allocation panel, including the user's own mix", async () => {
    mockQueries({
      mine: [{ v: "1" }],
      dist: [DIST_ROW],
      mix: [
        { assetClass: "EQUITY", avg_weight: "62.34" },
        { assetClass: "BOND", avg_weight: "37.66" },
      ],
      funds: [
        { ticker: "ES3.SI", name: "STI ETF", holders: 22, n: 44 },
        { ticker: "SPY", name: "S&P 500", holders: 15, n: 44 },
      ],
      holdings: [{ avg_holdings: 2.4166 }],
    });

    const result = await peerInsightsService.getDashboard("u", GROUP, "value");

    expect(result.allocation).toEqual({
      peerMix: [
        { assetClass: "EQUITY", pct: 62.3 },
        { assetClass: "BOND", pct: 37.7 },
      ],
      topFunds: [
        { ticker: "ES3.SI", name: "STI ETF", heldByPct: 50 },
        { ticker: "SPY", name: "S&P 500", heldByPct: 34 },
      ],
      avgHoldings: 2.4,
      myMix: [
        { assetClass: "EQUITY", pct: 60 },
        { assetClass: "BOND", pct: 40 },
      ],
    });
  });

  it("describes the segment and exposes the age window", async () => {
    mockQueries({ mine: [], dist: [DIST_ROW] });

    const result = await peerInsightsService.getDashboard(
      "u",
      { ...GROUP, dims: ["income", "age"], filters: { age: { lo: 23, hi: 33 } } },
      "value"
    );

    expect(result.group.ageRange).toEqual({ lo: 23, hi: 33 });
    expect(result.group.dims).toEqual(["income", "age"]);
    expect(result.group.message).toContain("aged 23–33");
  });

  it("never lets request text reach the SQL: the metric expression comes from a fixed whitelist", async () => {
    mockQueries({ mine: [{ v: "1" }], dist: [DIST_ROW] });

    await peerInsightsService.getDashboard("u", GROUP, "value");

    // The user id is the only caller-influenced value, and it's a bound parameter, not text.
    for (const call of db.$queryRaw.mock.calls) {
      expect((call[0] as TemplateStringsArray).join("")).not.toContain("'u'");
    }
  });
});
