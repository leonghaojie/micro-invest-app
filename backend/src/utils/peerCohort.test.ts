/**
 * Peer cohort engine (DECISIONS.md #18): the framework's rules, one at a time -
 * hard filters, normalisation, weighted distance, K nearest, fallback, statistics,
 * metric-specific peer sets, and the privacy floor.
 */
import { createRng } from "./syntheticPeers";
import {
  BENCHMARKS,
  benchmarkReturnPct,
  buildCohortReport,
  summarizeHoldings,
  buildObservation,
  buildPopulation,
  capacityOf,
  Card,
  compoundedReturnPct,
  describeBasis,
  describeGroup,
  distance,
  diversificationScore,
  GENERAL_WEIGHTS,
  identityLabels,
  investmentRatePct,
  largestHoldingPct,
  lifeStageLabel,
  LIFE_STAGE_SPAN_YEARS,
  Member,
  METRIC_WEIGHTS,
  midRank,
  quantile,
  returnPerRisk,
  selectPeers,
  summarize,
  trailingMonths,
  windowLength,
  windowReturns,
} from "./peerCohort";

// ── Fixtures ────────────────────────────────────────────────────────────

const AS_OF = "2026-09";
const MONTHS12 = trailingMonths(AS_OF, 12);

function member(id: string, over: Partial<Member> = {}): Member {
  return {
    id,
    age: 28,
    income: 4000,
    expense: 2400,
    risk: "MEDIUM",
    contribution: 400,
    consistencyPct: 100,
    holdings: [
      { assetClass: "EQUITY", weight: 0.6 },
      { assetClass: "BOND", weight: 0.4 },
    ],
    monthlyReturns: Object.fromEntries(MONTHS12.map((m) => [m, 0.01])),
    ...over,
  };
}

/** n deterministic, varied members. */
function population(n: number, seed = 7): Member[] {
  const rng = createRng(seed);
  const risks = ["LOW", "MEDIUM", "HIGH"] as const;
  return Array.from({ length: n }, (_, i) => {
    const income = Math.round(1500 + rng() * 9000);
    return member(`m${i}`, {
      age: 21 + Math.floor(rng() * 25),
      income,
      expense: Math.round(income * (0.4 + rng() * 0.45)),
      risk: risks[Math.floor(rng() * 3)],
      contribution: Math.round(income * (0.03 + rng() * 0.12)),
      consistencyPct: Math.round(40 + rng() * 60),
      monthlyReturns: Object.fromEntries(MONTHS12.map((m) => [m, (rng() - 0.45) * 0.06])),
    });
  });
}

// ── Numeric helpers ─────────────────────────────────────────────────────

describe("quantile / midRank / summarize", () => {
  it("quantile interpolates between ranks, like percentile_cont", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20, 30], 0.25)).toBe(15);
    expect(quantile([5], 0.9)).toBe(5);
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });

  it("midRank: strictly in (0,1) for an interior value and handles extremes", () => {
    expect(midRank([1, 2, 3, 4], 3)).toBeCloseTo(0.625, 10);
    expect(midRank([1, 2, 3, 4], 0)).toBe(0);
    expect(midRank([1, 2, 3, 4], 99)).toBe(1);
    expect(midRank([5, 5, 5, 5], 5)).toBe(0.5);
  });

  it("summarize reports median, quartiles, percentile and 'top X%'", () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8);
    expect(s).toMatchObject({ n: 10, median: 5.5, p25: 3.25, p75: 7.75, percentile: 75, topPct: 25 });
  });

  it("topPct is never below 1", () => {
    expect(summarize([1, 2, 3], 100).topPct).toBe(1);
  });

  it("is not affected by the order of the values", () => {
    expect(summarize([9, 1, 5, 3], 4)).toEqual(summarize([1, 3, 5, 9], 4));
  });
});

// ── Member measures ─────────────────────────────────────────────────────

describe("capacity and investment rate", () => {
  it("capacity is the share of income left after expenses", () => {
    expect(capacityOf({ income: 4000, expense: 2400 })).toBeCloseTo(0.4, 10);
    expect(capacityOf({ income: 0, expense: 100 })).toBe(0);
  });

  it("investment rate is contribution as a percent of income", () => {
    expect(investmentRatePct({ contribution: 400, income: 4000 })).toBe(10);
    expect(investmentRatePct({ contribution: 400, income: 0 })).toBeNull();
  });
});

describe("diversificationScore", () => {
  const eq = (n: number) => Array.from({ length: n }, () => ({ assetClass: "EQUITY", weight: 1 / n }));

  it("is 0 for a single holding and for no holdings", () => {
    expect(diversificationScore([{ assetClass: "EQUITY", weight: 1 }])).toBe(0);
    expect(diversificationScore([])).toBe(0);
  });

  it("is 100 when spread evenly over all five asset classes and ten funds", () => {
    const classes = ["EQUITY", "EQUITY_EM", "BOND", "REIT", "COMMODITY"];
    const ten = Array.from({ length: 10 }, (_, i) => ({ assetClass: classes[i % 5], weight: 0.1 }));
    expect(diversificationScore(ten)).toBe(100);
  });

  it("rewards more asset classes over more funds in one class", () => {
    const manyFundsOneClass = diversificationScore(eq(5));
    const twoClasses = diversificationScore([
      { assetClass: "EQUITY", weight: 0.5 },
      { assetClass: "BOND", weight: 0.5 },
    ]);
    expect(twoClasses).toBeGreaterThan(manyFundsOneClass);
  });

  it("falls as one holding takes over", () => {
    const even = diversificationScore([
      { assetClass: "EQUITY", weight: 0.5 },
      { assetClass: "BOND", weight: 0.5 },
    ]);
    const lopsided = diversificationScore([
      { assetClass: "EQUITY", weight: 0.9 },
      { assetClass: "BOND", weight: 0.1 },
    ]);
    expect(lopsided).toBeLessThan(even);
  });

  it("stays within 0-100", () => {
    for (const n of [1, 2, 3, 7, 12, 23]) {
      const s = diversificationScore(eq(n));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("largestHoldingPct is the biggest weight as a percent", () => {
    expect(largestHoldingPct([{ assetClass: "A", weight: 0.55 }, { assetClass: "B", weight: 0.45 }])).toBe(55);
    expect(largestHoldingPct([])).toBe(0);
  });
});

describe("windows and returns", () => {
  it("trailingMonths lists the n months ending at the month given, across a year end", () => {
    expect(trailingMonths("2026-09", 3)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(trailingMonths("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(trailingMonths("2026-09", 12)[0]).toBe("2025-10");
  });

  it("windowReturns needs every month, otherwise null", () => {
    const m = member("a", { monthlyReturns: { "2026-08": 0.02, "2026-09": 0.01 } });
    expect(windowReturns(m, ["2026-08", "2026-09"])).toEqual([0.02, 0.01]);
    expect(windowReturns(m, ["2026-07", "2026-08", "2026-09"])).toBeNull();
  });

  it("windowLength is the longest recent run of months, up to a year", () => {
    expect(windowLength(member("a"), AS_OF)).toBe(12);
    expect(windowLength(member("b", { monthlyReturns: { "2026-08": 0.01, "2026-09": 0.01 } }), AS_OF)).toBe(2);
    expect(windowLength(member("c", { monthlyReturns: { "2026-05": 0.01 } }), AS_OF)).toBe(0); // gap before the end
    expect(windowLength(member("d", { monthlyReturns: {} }), AS_OF)).toBe(0);
  });

  it("compoundedReturnPct compounds month by month", () => {
    expect(compoundedReturnPct([0.1, -0.1])).toBe(-1); // 1.1 x 0.9 = 0.99
    expect(compoundedReturnPct([0.01, 0.01, 0.01])).toBeCloseTo(3.03, 2);
  });

  describe("returnPerRisk", () => {
    it("is withheld below 6 months and when returns never move", () => {
      expect(returnPerRisk([0.01, 0.02, 0.01, 0.0, 0.02])).toBeNull();
      expect(returnPerRisk(Array(12).fill(0.01))).toBeNull();
    });

    it("is annualised return over annualised volatility", () => {
      const r = [0.02, -0.01, 0.03, 0.0, 0.02, 0.01, -0.02, 0.03, 0.01, 0.0, 0.02, 0.01];
      const growth = r.reduce((a, x) => a * (1 + x), 1);
      const mean = r.reduce((a, b) => a + b, 0) / 12;
      const vol = Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / 11) * Math.sqrt(12);
      expect(returnPerRisk(r)).toBeCloseTo((growth - 1) / vol, 1);
    });

    it("is higher for the same return with less swing", () => {
      const smooth = Array.from({ length: 12 }, (_, i) => 0.01 + (i % 2 ? 0.002 : -0.002));
      const rough = Array.from({ length: 12 }, (_, i) => 0.01 + (i % 2 ? 0.03 : -0.03));
      expect(returnPerRisk(smooth)!).toBeGreaterThan(returnPerRisk(rough)!);
    });
  });
});

describe("benchmarkReturnPct", () => {
  const months = ["2026-08", "2026-09"];
  const funds = {
    VT: { "2026-08": 0.02, "2026-09": 0.04 },
    AGG: { "2026-08": 0.0, "2026-09": 0.01 },
  };

  it("blends the stock and bond funds at the risk level's weights, month by month", () => {
    // MEDIUM 60/40: Aug 0.6*0.02 = 0.012; Sep 0.6*0.04 + 0.4*0.01 = 0.028 -> 1.012*1.028 - 1
    expect(benchmarkReturnPct("MEDIUM", funds, months)).toBeCloseTo((1.012 * 1.028 - 1) * 100, 2);
    // HIGH is all stocks
    expect(benchmarkReturnPct("HIGH", funds, months)).toBeCloseTo((1.02 * 1.04 - 1) * 100, 2);
    // LOW 20/80: Aug 0.004; Sep 0.2*0.04 + 0.8*0.01 = 0.016
    expect(benchmarkReturnPct("LOW", funds, months)).toBeCloseTo((1.004 * 1.016 - 1) * 100, 2);
  });

  it("is ordered by risk when stocks beat bonds", () => {
    const low = benchmarkReturnPct("LOW", funds, months)!;
    const mid = benchmarkReturnPct("MEDIUM", funds, months)!;
    const high = benchmarkReturnPct("HIGH", funds, months)!;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("is null if a fund is missing a month", () => {
    expect(benchmarkReturnPct("MEDIUM", { VT: funds.VT, AGG: { "2026-08": 0 } }, months)).toBeNull();
    expect(benchmarkReturnPct("MEDIUM", { VT: funds.VT }, months)).toBeNull();
  });

  it("every benchmark's weights add to 1", () => {
    for (const b of Object.values(BENCHMARKS)) expect(Object.values(b.mix).reduce((a, w) => a + w, 0)).toBeCloseTo(1, 10);
  });
});

// ── Weights ─────────────────────────────────────────────────────────────

describe("weights (framework, re-split over profile-only features)", () => {
  it("every weight set adds up to 1", () => {
    const sets = [GENERAL_WEIGHTS, ...Object.values(METRIC_WEIGHTS)];
    for (const w of sets) expect(Object.values(w).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("match the agreed figures", () => {
    expect(GENERAL_WEIGHTS).toEqual({ income: 0.35, capacity: 0.35, life: 0.2, risk: 0.1 });
    expect(METRIC_WEIGHTS.investmentRate).toEqual({ income: 0.4, capacity: 0.4, life: 0.2 });
    expect(METRIC_WEIGHTS.diversification).toEqual({ risk: 0.4, capacity: 0.3, income: 0.15, life: 0.15 });
    expect(METRIC_WEIGHTS.return).toEqual({ risk: 0.5, life: 0.2, income: 0.15, capacity: 0.15 });
    expect(METRIC_WEIGHTS.returnPerRisk).toEqual(METRIC_WEIGHTS.return);
  });

  it("only use who the person is (profile), never what their investing produced", () => {
    const profileOnly = new Set(["income", "capacity", "life", "risk"]);
    for (const w of [GENERAL_WEIGHTS, ...Object.values(METRIC_WEIGHTS)]) {
      for (const k of Object.keys(w)) expect(profileOnly.has(k)).toBe(true);
    }
  });

  it("risk barely matters for saving behaviour but dominates returns", () => {
    expect(METRIC_WEIGHTS.investmentRate.risk).toBeUndefined();
    expect(METRIC_WEIGHTS.return.risk!).toBeGreaterThan(METRIC_WEIGHTS.return.income!);
  });
});

// ── Normalisation and distance ──────────────────────────────────────────

describe("buildPopulation (normalisation)", () => {
  it("turns skewed incomes into percentiles, so one extreme value does not squash everyone else", () => {
    const members = [1000, 2000, 3000, 4000, 1_000_000].map((income, i) => member(`m${i}`, { income }));
    const pop = buildPopulation(members);
    expect(pop.features.get("m0")!.income).toBeLessThan(pop.features.get("m3")!.income);
    // 4000 and 1,000,000 are one rank apart, however far apart in dollars
    expect(pop.features.get("m4")!.income - pop.features.get("m3")!.income).toBeCloseTo(0.2, 10);
  });

  it("gives equal members equal percentiles", () => {
    const pop = buildPopulation([member("a"), member("b"), member("c")]);
    expect(pop.features.get("a")!.income).toBe(pop.features.get("b")!.income);
  });
});

describe("distance", () => {
  const pop = buildPopulation([
    member("a", { age: 25, income: 3000, risk: "LOW" }),
    member("b", { age: 25, income: 3000, risk: "LOW" }),
    member("c", { age: 45, income: 9000, risk: "HIGH" }),
  ]);
  const f = (id: string) => pop.features.get(id)!;

  it("is zero between identical members and symmetric", () => {
    expect(distance(GENERAL_WEIGHTS, f("a"), f("b"))).toBe(0);
    expect(distance(GENERAL_WEIGHTS, f("a"), f("c"))).toBeCloseTo(distance(GENERAL_WEIGHTS, f("c"), f("a")), 10);
  });

  it("is larger for members that differ more", () => {
    expect(distance(GENERAL_WEIGHTS, f("a"), f("c"))).toBeGreaterThan(0);
  });

  it("never exceeds the total weight", () => {
    for (const w of [GENERAL_WEIGHTS, ...Object.values(METRIC_WEIGHTS)]) {
      const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
      expect(distance(w, f("a"), f("c"))).toBeLessThanOrEqual(total + 1e-9);
    }
  });

  it("ignores features that carry no weight", () => {
    // only income counts: a/b share the bottom rank, c is on top
    expect(distance({ income: 1 }, f("a"), f("c"))).toBeCloseTo(0.5, 10);
    // only risk counts, and a/c are at opposite ends
    expect(distance({ risk: 1 }, f("a"), f("c"))).toBeCloseTo(1, 10);
  });

  it("treats an age gap as fully different at the life-stage span, and no more", () => {
    const young = pop.features.get("a")!;
    const older = { ...young, age: young.age + LIFE_STAGE_SPAN_YEARS };
    const muchOlder = { ...young, age: young.age + 3 * LIFE_STAGE_SPAN_YEARS };
    expect(distance({ life: 1 }, young, older)).toBe(1);
    expect(distance({ life: 1 }, young, muchOlder)).toBe(1);
    expect(distance({ life: 1 }, young, { ...young, age: young.age + LIFE_STAGE_SPAN_YEARS / 3 })).toBeCloseTo(1 / 3, 10);
  });

  it("does not see outcomes: holdings, contribution and returns change nothing", () => {
    const same = buildPopulation([
      member("x", { holdings: [{ assetClass: "EQUITY", weight: 1 }], contribution: 50, monthlyReturns: { [AS_OF]: 0.2 } }),
      member("y", { holdings: [{ assetClass: "COMMODITY", weight: 1 }], contribution: 2000, monthlyReturns: { [AS_OF]: -0.2 } }),
    ]);
    for (const w of [GENERAL_WEIGHTS, ...Object.values(METRIC_WEIGHTS)]) {
      expect(distance(w, same.features.get("x")!, same.features.get("y")!)).toBe(0);
    }
  });
});

// ── Selecting peers ─────────────────────────────────────────────────────

describe("selectPeers", () => {
  const OPTS = { hardRisk: false, eligible: () => true, minGroup: 10 };

  it("never includes the user, and returns the nearest first", () => {
    const members = [
      member("me", { income: 4000 }),
      member("near", { income: 4100 }),
      member("mid", { income: 6000 }),
      member("far", { income: 12_000 }),
      ...Array.from({ length: 12 }, (_, i) => member(`pad${i}`, { income: 4000 + 300 * i })),
    ];
    const pop = buildPopulation(members);
    const sel = selectPeers(pop, members[0], { income: 1 }, { ...OPTS, k: 5, minCohort: 5 });
    expect(sel.peers.map((p) => p.id)).not.toContain("me");
    expect(sel.peers).toHaveLength(5);
    // pad0 has exactly my income (distance 0), then near (4100), then the next closest
    expect(sel.peers.slice(0, 2).map((p) => p.id)).toEqual(["pad0", "near"]);
    // sorted by distance: each is at least as far as the one before
    const f = (m: Member) => pop.features.get(m.id)!.income;
    const d = sel.peers.map((p) => Math.abs(f(p) - f(members[0])));
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it("keeps at most K peers", () => {
    const members = population(120);
    const pop = buildPopulation(members);
    expect(selectPeers(pop, members[0], GENERAL_WEIGHTS, { ...OPTS, k: 40 }).peers).toHaveLength(40);
    expect(selectPeers(pop, members[0], GENERAL_WEIGHTS, OPTS).peers).toHaveLength(50); // default K
  });

  it("uses the defaults when K and the minimum cohort are passed as undefined", () => {
    const members = population(120);
    const sel = selectPeers(buildPopulation(members), members[0], GENERAL_WEIGHTS, { ...OPTS, k: undefined, minCohort: undefined });
    expect(sel.peers).toHaveLength(50);
  });

  it("returns everyone eligible when there are fewer than K", () => {
    const members = population(25);
    const sel = selectPeers(buildPopulation(members), members[0], GENERAL_WEIGHTS, { ...OPTS, k: 50, minCohort: 10 });
    expect(sel.peers).toHaveLength(24);
  });

  it("is deterministic, with ties broken by id, whatever order the members arrive in", () => {
    const twins = Array.from({ length: 30 }, (_, i) => member(`t${String(i).padStart(2, "0")}`)); // all identical
    const me = member("me");
    const a = selectPeers(buildPopulation([me, ...twins]), me, GENERAL_WEIGHTS, { ...OPTS, k: 10, minCohort: 5 });
    const b = selectPeers(buildPopulation([...[...twins].reverse(), me]), me, GENERAL_WEIGHTS, { ...OPTS, k: 10, minCohort: 5 });
    expect(a.peers.map((p) => p.id)).toEqual(b.peers.map((p) => p.id));
    expect(a.peers.map((p) => p.id)).toEqual(["t00", "t01", "t02", "t03", "t04", "t05", "t06", "t07", "t08", "t09"]);
  });

  it("only considers members who have the metric", () => {
    const members = population(60);
    const sel = selectPeers(buildPopulation(members), members[0], GENERAL_WEIGHTS, {
      ...OPTS,
      eligible: (m) => Number(m.id.slice(1)) % 2 === 0,
    });
    expect(sel.peers.every((p) => Number(p.id.slice(1)) % 2 === 0)).toBe(true);
  });

  it("different weights pick different peers (the point of metric-specific groups)", () => {
    const members = population(200, 11);
    const pop = buildPopulation(members);
    const byIncome = selectPeers(pop, members[0], { income: 1 }, { ...OPTS, k: 30 }).peers.map((p) => p.id);
    const byRisk = selectPeers(pop, members[0], { risk: 1 }, { ...OPTS, k: 30 }).peers.map((p) => p.id);
    const overlap = byIncome.filter((id) => byRisk.includes(id)).length;
    expect(overlap).toBeLessThan(25);
  });

  describe("hard risk filter and fallback", () => {
    const risky = (id: string, risk: Member["risk"]) => member(id, { risk });
    const crowd = (n: number, risk: Member["risk"], tag: string) => Array.from({ length: n }, (_, i) => risky(`${tag}${i}`, risk));

    it("uses only the same risk level when there are enough of them", () => {
      const me = risky("me", "MEDIUM");
      const members = [me, ...crowd(40, "MEDIUM", "m"), ...crowd(40, "LOW", "l"), ...crowd(40, "HIGH", "h")];
      const sel = selectPeers(buildPopulation(members), me, METRIC_WEIGHTS.return, { ...OPTS, hardRisk: true });
      expect(sel.peers.every((p) => p.risk === "MEDIUM")).toBe(true);
      expect(sel.filter).toBe("same risk level");
      expect(sel.relaxations).toEqual([]);
      expect(sel.small).toBe(false);
    });

    it("widens to adjacent risk levels when the same level has too few, and says so", () => {
      const me = risky("me", "MEDIUM");
      const members = [me, ...crowd(12, "MEDIUM", "m"), ...crowd(30, "LOW", "l"), ...crowd(30, "HIGH", "h")];
      const sel = selectPeers(buildPopulation(members), me, METRIC_WEIGHTS.return, { ...OPTS, hardRisk: true });
      expect(sel.filter).toBe("adjacent risk levels");
      expect(sel.relaxations).toHaveLength(1);
      expect(sel.relaxations[0]).toMatch(/neighbouring risk levels/);
      expect(sel.peers.some((p) => p.risk !== "MEDIUM")).toBe(true);
    });

    it("an extreme risk level only has one neighbour, and widens to everyone if that is not enough", () => {
      const me = risky("me", "HIGH");
      const members = [me, ...crowd(5, "HIGH", "h"), ...crowd(8, "MEDIUM", "m"), ...crowd(40, "LOW", "l")];
      const sel = selectPeers(buildPopulation(members), me, METRIC_WEIGHTS.return, { ...OPTS, hardRisk: true });
      expect(sel.filter).toBeNull();
      expect(sel.relaxations).toHaveLength(2);
      expect(sel.relaxations[1]).toMatch(/all risk levels/);
    });

    it("does not apply the risk filter to metrics that do not need it", () => {
      const me = risky("me", "MEDIUM");
      const members = [me, ...crowd(40, "MEDIUM", "m"), ...crowd(40, "LOW", "l")];
      const sel = selectPeers(buildPopulation(members), me, METRIC_WEIGHTS.investmentRate, { ...OPTS, hardRisk: false });
      expect(sel.filter).toBeNull();
      expect(sel.relaxations).toEqual([]);
    });
  });

  describe("privacy floor", () => {
    it("withholds a peer set smaller than the floor, even after widening", () => {
      const members = population(8);
      const sel = selectPeers(buildPopulation(members), members[0], GENERAL_WEIGHTS, { ...OPTS, minGroup: 10 });
      expect(sel.suppressed).toBe(true);
    });

    it("shows a set that meets the floor but is below the preferred size, flagged as small", () => {
      const members = population(20);
      const sel = selectPeers(buildPopulation(members), members[0], GENERAL_WEIGHTS, { ...OPTS, minGroup: 10, minCohort: 30 });
      expect(sel.suppressed).toBe(false);
      expect(sel.small).toBe(true);
    });

    it("counts exactly at the floor as enough", () => {
      const members = population(11); // 10 others
      expect(selectPeers(buildPopulation(members), members[0], GENERAL_WEIGHTS, { ...OPTS, minGroup: 10 }).suppressed).toBe(false);
      const fewer = population(10); // 9 others
      expect(selectPeers(buildPopulation(fewer), fewer[0], GENERAL_WEIGHTS, { ...OPTS, minGroup: 10 }).suppressed).toBe(true);
    });
  });
});

// ── Descriptions ────────────────────────────────────────────────────────

describe("plain-language descriptions", () => {
  it("describeBasis names the features that count most, heaviest first", () => {
    expect(describeBasis(METRIC_WEIGHTS.investmentRate)).toBe("similar income, investment capacity and life stage");
    expect(describeBasis(METRIC_WEIGHTS.return)).toBe("similar risk level, life stage, income and investment capacity");
    expect(describeBasis(METRIC_WEIGHTS.diversification)).toBe("similar risk level, investment capacity, income and life stage");
  });

  it("lifeStageLabel splits at 26, 36 and 51", () => {
    expect(lifeStageLabel(22)).toBe("Young investor");
    expect(lifeStageLabel(25)).toBe("Young investor");
    expect(lifeStageLabel(26)).toBe("Early-career investor");
    expect(lifeStageLabel(35)).toBe("Early-career investor");
    expect(lifeStageLabel(36)).toBe("Mid-career investor");
    expect(lifeStageLabel(51)).toBe("Established investor");
  });

  it("identityLabels gives four broad labels, all about the person (no investing outcome), with tiers from where the user sits in the population", () => {
    const members = Array.from({ length: 30 }, (_, i) => member(`m${i}`, { income: 1000 + i * 500, expense: 600 + i * 100 }));
    const pop = buildPopulation(members);
    const low = identityLabels(pop, members[1]);
    const high = identityLabels(pop, members[28]);
    expect(low).toHaveLength(4);
    expect(low[1]).toBe("Lower income");
    expect(high[1]).toBe("Higher income");
    expect(low[3]).toBe("Balanced risk");
  });

  it("describeGroup gives the middle 80% of age and contribution, and risk shares", () => {
    const peers = Array.from({ length: 100 }, (_, i) => member(`p${i}`, { age: 20 + (i % 20), contribution: 100 + i * 10, risk: i % 2 ? "HIGH" : "MEDIUM" }));
    const g = describeGroup(peers);
    expect(g.size).toBe(100);
    expect(g.ageRange[0]).toBeGreaterThanOrEqual(20);
    expect(g.ageRange[1]).toBeLessThanOrEqual(39);
    expect(g.contributionRange[0]).toBeLessThan(g.contributionRange[1]);
    expect(g.risk).toEqual({ LOW: 0, MEDIUM: 50, HIGH: 50 });
  });
});

// ── The report ──────────────────────────────────────────────────────────

describe("buildCohortReport", () => {
  const fundReturns = { VT: Object.fromEntries(MONTHS12.map((m) => [m, 0.01])), AGG: Object.fromEntries(MONTHS12.map((m) => [m, 0.003])) };
  const ctx = { asOf: AS_OF, fundReturns, minGroup: 10 };
  const members = population(250, 21);
  const me = members[0];
  const pop = buildPopulation(members);

  it("gives five cards, an identity, a group, and a headline with a benchmark", () => {
    const r = buildCohortReport(pop, me, ctx);
    expect(r.suppressed).toBe(false);
    expect(r.identity).toHaveLength(4);
    expect(r.cards.map((c) => c.key)).toEqual(["investmentRate", "consistency", "diversification", "return", "returnPerRisk"]);
    expect(r.cards.every((c) => c.status === "ok")).toBe(true);
    expect(r.group!.size).toBeGreaterThan(0);
    expect(r.headline).toMatchObject({ windowMonths: 12 });
    expect(r.headline!.benchmark!.label).toBe(BENCHMARKS[me.risk].label);
  });

  it("returns are compared with the same risk level only", () => {
    const r = buildCohortReport(pop, me, ctx);
    const ret = r.cards.find((c) => c.key === "return")!;
    expect(ret.filter).toBe("same risk level");
    // verify independently: the peers a return card uses all share the user's risk level
    const sel = selectPeers(pop, me, METRIC_WEIGHTS.return, { hardRisk: true, eligible: (m) => windowReturns(m, MONTHS12) !== null, minGroup: 10 });
    expect(sel.peers.every((p) => p.risk === me.risk)).toBe(true);
  });

  it("each card says what its peers were chosen for", () => {
    const r = buildCohortReport(pop, me, ctx);
    expect(r.cards.find((c) => c.key === "investmentRate")!.basis).toContain("income");
    expect(r.cards.find((c) => c.key === "investmentRate")!.filter).toBeNull();
    // the hard risk filter already pins risk level, so the basis does not repeat it as "similar"
    const ret = r.cards.find((c) => c.key === "return")!;
    expect(ret.filter).toBe("same risk level");
    expect(ret.basis).toBe("similar life stage, income and investment capacity");
    expect(r.cards.find((c) => c.key === "diversification")!.basis).toContain("risk level");
  });

  it("cards use different peer sets (different weights, different people)", () => {
    const rate = selectPeers(pop, me, METRIC_WEIGHTS.investmentRate, { hardRisk: false, eligible: () => true, minGroup: 10 }).peers.map((p) => p.id);
    const div = selectPeers(pop, me, METRIC_WEIGHTS.diversification, { hardRisk: false, eligible: () => true, minGroup: 10 }).peers.map((p) => p.id);
    expect(rate.filter((id) => div.includes(id)).length).toBeLessThan(rate.length);
  });

  it("the percentile and top-X% are consistent and in range", () => {
    for (const c of buildCohortReport(pop, me, ctx).cards) {
      expect(c.percentile).toBeGreaterThanOrEqual(0);
      expect(c.percentile).toBeLessThanOrEqual(100);
      expect(c.topPct).toBe(Math.max(1, 100 - (c.percentile as number)));
      expect(c.cohortSize).toBeLessThanOrEqual(50);
      expect(c.p25!).toBeLessThanOrEqual(c.median!);
      expect(c.median!).toBeLessThanOrEqual(c.p75!);
    }
  });

  it("diversification carries the largest-holding figure that explains it", () => {
    const d = buildCohortReport(pop, me, ctx).cards.find((c) => c.key === "diversification")!;
    expect(d.detail).toMatchObject({ label: "Largest holding", you: largestHoldingPct(me.holdings), unit: "%" });
    expect(d.detail!.median).toBeGreaterThan(0);
  });

  it("with fewer than 6 months of history, return works but return-per-risk is explained, not shown", () => {
    const short = member("short", { monthlyReturns: Object.fromEntries(trailingMonths(AS_OF, 4).map((m) => [m, 0.01])) });
    const pop2 = buildPopulation([short, ...members.slice(1)]);
    const r = buildCohortReport(pop2, short, ctx);
    expect(r.headline!.windowMonths).toBe(4);
    expect(r.cards.find((c) => c.key === "return")!.status).toBe("ok");
    const rpr = r.cards.find((c) => c.key === "returnPerRisk")!;
    expect(rpr.status).toBe("unavailable");
    expect(rpr.message).toMatch(/at least 6 months.*you have 4/);
  });

  it("compares returns over the user's own window, against peers who have that same window", () => {
    const short = member("short", { monthlyReturns: Object.fromEntries(trailingMonths(AS_OF, 3).map((m) => [m, 0.02])) });
    const longer = members.slice(1, 120).map((m) => ({ ...m }));
    const r = buildCohortReport(buildPopulation([short, ...longer]), short, ctx);
    // 3 months at 2% each, compounded
    expect(r.cards.find((c) => c.key === "return")!.you).toBeCloseTo((1.02 ** 3 - 1) * 100, 1);
  });

  it("a user with no plan history gets explained cards for returns but still gets the rest", () => {
    const none = member("none", { monthlyReturns: {} });
    const r = buildCohortReport(buildPopulation([none, ...members.slice(1)]), none, ctx);
    expect(r.headline).toBeNull();
    expect(r.cards.find((c) => c.key === "return")!.status).toBe("unavailable");
    expect(r.cards.find((c) => c.key === "investmentRate")!.status).toBe("ok");
  });

  it("is withheld entirely when the whole population is below the privacy floor", () => {
    const tiny = population(8);
    const r = buildCohortReport(buildPopulation(tiny), tiny[0], ctx);
    expect(r.suppressed).toBe(true);
    expect(r.cards).toEqual([]);
    expect(r.group).toBeNull();
    expect(r.headline).toBeNull();
  });

  it("withholds a single card whose comparable peers are too few, without hiding the others", () => {
    // nearly nobody else has a return history
    const sparse = members.map((m, i) => (i === 0 || i > 245 ? m : { ...m, monthlyReturns: {} }));
    const r = buildCohortReport(buildPopulation(sparse), sparse[0], ctx);
    const ret = r.cards.find((c) => c.key === "return")!;
    expect(ret.status).toBe("withheld");
    expect(ret.median).toBeUndefined();
    expect(r.cards.find((c) => c.key === "investmentRate")!.status).toBe("ok");
  });

  it("is deterministic", () => {
    expect(buildCohortReport(pop, me, ctx)).toEqual(buildCohortReport(pop, me, ctx));
  });

  it("never exposes who the peers are: no ids anywhere in the report", () => {
    const json = JSON.stringify(buildCohortReport(pop, me, ctx));
    for (const m of members.slice(0, 50)) expect(json).not.toContain(`"${m.id}"`);
    expect(json).not.toMatch(/"id"/);
  });

  it("the benchmark is null (not wrong) when fund data for the window is missing", () => {
    const r = buildCohortReport(pop, me, { ...ctx, fundReturns: { VT: fundReturns.VT } });
    expect(r.headline!.benchmark).toBeNull();
  });
});

describe("contribution consistency card (DECISIONS.md #19)", () => {
  const members = population(120, 21);
  const pop = buildPopulation(members);
  const me = members[0];
  const ctx = { asOf: AS_OF, fundReturns: { VT: Object.fromEntries(MONTHS12.map((m) => [m, 0.01])), AGG: Object.fromEntries(MONTHS12.map((m) => [m, 0.003])) }, minGroup: 10 };

  it("compares the user's consistency with peers matched on income, capacity and life stage", () => {
    const card = buildCohortReport(pop, me, ctx).cards.find((c) => c.key === "consistency")!;
    expect(card.status).toBe("ok");
    expect(card.unit).toBe("%");
    expect(card.you).toBe(me.consistencyPct);
    expect(card.basis).toBe("similar income, investment capacity and life stage");
    expect(card.filter).toBeNull(); // no hard risk filter: it is behaviour, not return
    expect(card.cohortSize).toBeGreaterThan(0);
  });

  it("uses the same weights as the investment rate, and none that depend on outcomes", () => {
    expect(METRIC_WEIGHTS.consistency).toEqual(METRIC_WEIGHTS.investmentRate);
  });

  it("is unavailable, with the reason, for a user with too little history", () => {
    const young = members.map((m, i) => (i === 0 ? { ...m, consistencyPct: null } : m));
    const card = buildCohortReport(buildPopulation(young), young[0], ctx).cards.find((c) => c.key === "consistency")!;
    expect(card.status).toBe("unavailable");
    expect(card.message).toMatch(/at least 3 months/);
  });

  it("leaves people without enough history out of the peers rather than counting them as 0", () => {
    const some = members.map((m, i) => (i % 2 === 1 ? { ...m, consistencyPct: null } : m));
    const sel = selectPeers(buildPopulation(some), some[0], METRIC_WEIGHTS.consistency, { hardRisk: false, eligible: (m) => m.consistencyPct !== null, minGroup: 10 });
    expect(sel.peers.every((p) => p.consistencyPct !== null)).toBe(true);
  });

  it("does not move who is a peer: consistency is not a matching feature", () => {
    const a = selectPeers(pop, me, METRIC_WEIGHTS.investmentRate, { hardRisk: false, eligible: () => true, minGroup: 10 }).peers.map((p) => p.id);
    const changed = members.map((m) => ({ ...m, consistencyPct: 50 }));
    const b = selectPeers(buildPopulation(changed), changed[0], METRIC_WEIGHTS.investmentRate, { hardRisk: false, eligible: () => true, minGroup: 10 }).peers.map((p) => p.id);
    expect(b).toEqual(a);
  });
});

describe("buildObservation", () => {
  const card = (key: Card["key"], percentile: number, extra: Partial<Card> = {}): Card => ({
    key,
    label: {
      investmentRate: "Monthly investment rate",
      consistency: "Contribution consistency",
      diversification: "Diversification score",
      return: "Portfolio return",
      returnPerRisk: "Return per unit of risk",
    }[key],
    unit: "%",
    status: "ok",
    percentile,
    topPct: 100 - percentile,
    basis: "",
    filter: null,
    relaxations: [],
    ...extra,
  });

  it("names the strongest and weakest, with the figure behind a diversification gap", () => {
    const text = buildObservation([
      card("investmentRate", 80),
      card("diversification", 20, { detail: { label: "Largest holding", you: 55, median: 32, unit: "%" } }),
      card("return", 50),
    ])!;
    expect(text).toContain("ahead of similar investors on monthly investment rate");
    expect(text).toContain("largest holding is 55% against a peer median of 32%");
  });

  it("says so when ahead of everything", () => {
    expect(buildObservation([card("investmentRate", 85), card("diversification", 60)])).toMatch(/ahead.*not behind on anything else/);
  });

  it("says so when only behind on something", () => {
    expect(buildObservation([card("investmentRate", 50), card("return", 15)])).toMatch(/close to the middle on most measures, but you are behind most of them on portfolio return/);
  });

  it("says so when in the middle on everything", () => {
    expect(buildObservation([card("investmentRate", 52), card("return", 47)])).toBe("You are close to the middle of similar investors on every measure shown.");
  });

  it("ignores cards without figures and is null with none", () => {
    expect(buildObservation([])).toBeNull();
    expect(buildObservation([{ ...card("return", 0), status: "unavailable", percentile: undefined }])).toBeNull();
  });

  it("is descriptive only: no instruction to change anything", () => {
    const text = buildObservation([card("investmentRate", 90), card("diversification", 5, { detail: { label: "Largest holding", you: 80, median: 30, unit: "%" } })])!;
    expect(text).not.toMatch(/should|could improve|reduce|increase|consider|try to/i);
  });
});

// ── What the peers hold (DECISIONS.md #21) ──────────────────────────────

describe("summarizeHoldings", () => {
  const h = (assetClass: string, ticker: string, weight = 1) => ({ assetClass, ticker, name: `${ticker} fund`, weight });
  const holder = (id: string, holdings: ReturnType<typeof h>[]) => member(id, { holdings });
  const me = holder("me", [h("EQUITY", "VT", 0.6), h("BOND", "AGG", 0.4)]);

  it("averages the peers' asset-class mix (it adds up to 100) and gives the user's own", () => {
    const peers = [...Array.from({ length: 10 }, (_, i) => holder(`e${i}`, [h("EQUITY", "VT")])), ...Array.from({ length: 10 }, (_, i) => holder(`b${i}`, [h("BOND", "AGG")]))];
    const r = summarizeHoldings(peers, me, 10)!;
    expect(r.peerMix).toEqual([{ assetClass: "BOND", pct: 50 }, { assetClass: "EQUITY", pct: 50 }]);
    expect(r.peerMix.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 5);
    expect(r.myMix).toEqual([{ assetClass: "EQUITY", pct: 60 }, { assetClass: "BOND", pct: 40 }]);
    expect(r.peerCount).toBe(20);
  });

  it("lists the funds most peers hold, with the share of peers, largest first, and marks the ones the user holds", () => {
    const peers = [
      ...Array.from({ length: 12 }, (_, i) => holder(`a${i}`, [h("EQUITY", "VT")])),
      ...Array.from({ length: 6 }, (_, i) => holder(`b${i}`, [h("BOND", "AGG"), h("EQUITY", "VT", 0.5)])),
      ...Array.from({ length: 2 }, (_, i) => holder(`c${i}`, [h("COMMODITY", "GLD")])),
    ];
    const r = summarizeHoldings(peers, me, 10)!;
    expect(r.topFunds.map((f) => [f.ticker, f.heldByPct, f.youHold])).toEqual([
      ["VT", 90, true], // 18 of 20
      ["AGG", 30, true], // 6 of 20
    ]);
    expect(r.topFunds[0].name).toBe("VT fund");
  });

  it("never lists a fund held by fewer than 3 peers (so a list cannot describe one or two people)", () => {
    const base = Array.from({ length: 10 }, (_, i) => holder(`a${i}`, [h("EQUITY", "VT")]));
    const two = summarizeHoldings([...base, holder("x1", [h("COMMODITY", "GLD")]), holder("x2", [h("COMMODITY", "GLD")])], me, 10)!;
    expect(two.topFunds.map((f) => f.ticker)).not.toContain("GLD");
    const three = summarizeHoldings([...base, holder("x1", [h("COMMODITY", "GLD")]), holder("x2", [h("COMMODITY", "GLD")]), holder("x3", [h("COMMODITY", "GLD")])], me, 10)!;
    expect(three.topFunds.map((f) => f.ticker)).toContain("GLD");
  });

  it("shows at most six funds, ties broken by ticker so the order is stable", () => {
    const tickers = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const peers = tickers.flatMap((t) => Array.from({ length: 4 }, (_, i) => holder(`${t}${i}`, [h("EQUITY", t)])));
    const r = summarizeHoldings(peers, me, 10)!;
    expect(r.topFunds.map((f) => f.ticker)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("counts how many funds the peers hold on average and how many the user holds", () => {
    const peers = [...Array.from({ length: 5 }, (_, i) => holder(`a${i}`, [h("EQUITY", "VT")])), ...Array.from({ length: 5 }, (_, i) => holder(`b${i}`, [h("EQUITY", "VT", 0.5), h("BOND", "AGG", 0.5), h("COMMODITY", "GLD", 0.0)]))];
    const r = summarizeHoldings(peers, me, 10)!;
    expect(r.avgFunds).toBe(2);
    expect(r.myFunds).toBe(2);
  });

  it("leaves out peers who hold nothing, and is null under the privacy floor or when the user holds nothing", () => {
    const peers = [...Array.from({ length: 9 }, (_, i) => holder(`a${i}`, [h("EQUITY", "VT")])), holder("empty", [])];
    expect(summarizeHoldings(peers, me, 10)).toBeNull(); // only 9 hold something
    expect(summarizeHoldings([...peers, holder("more", [h("EQUITY", "VT")])], me, 10)!.peerCount).toBe(10);
    expect(summarizeHoldings(peers, holder("none", []), 5)).toBeNull();
  });

  it("ignores funds with no ticker rather than failing", () => {
    const peers = Array.from({ length: 10 }, (_, i) => member(`a${i}`, { holdings: [{ assetClass: "EQUITY", weight: 1 }] }));
    const r = summarizeHoldings(peers, me, 10)!;
    expect(r.topFunds).toEqual([]);
    expect(r.peerMix).toEqual([{ assetClass: "EQUITY", pct: 100 }]);
  });
});

describe("the cohort report's holdings", () => {
  const members = population(150, 41).map((m, i) => ({
    ...m,
    holdings: [
      { assetClass: i % 2 ? "EQUITY" : "BOND", ticker: i % 2 ? "VT" : "AGG", name: i % 2 ? "World" : "Bonds", weight: 0.7 },
      { assetClass: "COMMODITY", ticker: "GLD", name: "Gold", weight: 0.3 },
    ],
  }));
  const me = members[0];
  const ctx = { asOf: AS_OF, fundReturns: { VT: Object.fromEntries(MONTHS12.map((m) => [m, 0.01])), AGG: Object.fromEntries(MONTHS12.map((m) => [m, 0.003])) }, minGroup: 10 };

  it("describes the same peers as the diversification row", () => {
    const r = buildCohortReport(buildPopulation(members), me, ctx);
    const div = r.cards.find((c) => c.key === "diversification")!;
    expect(r.holdings!.peerCount).toBe(div.cohortSize);
    expect(r.holdings!.peerMix.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 0);
    expect(r.holdings!.myFunds).toBe(2);
  });

  it("is null when the whole pool is too small to describe", () => {
    const r = buildCohortReport(buildPopulation(members.slice(0, 6)), members[0], ctx);
    expect(r.suppressed).toBe(true);
    expect(r.holdings).toBeNull();
  });

  it("carries no ids and no per-person portfolio", () => {
    const json = JSON.stringify(buildCohortReport(buildPopulation(members), me, ctx).holdings);
    for (const m of members.slice(0, 40)) expect(json).not.toContain(`"${m.id}"`);
    expect(json).not.toMatch(/weight/);
  });
});
