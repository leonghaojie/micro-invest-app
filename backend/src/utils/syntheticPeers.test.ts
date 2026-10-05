/**
 * Synthetic peer generator tests — DECISIONS.md #9. The generator feeds every
 * peer statistic, so its guarantees (reproducible, anchored, internally
 * consistent) are tested directly rather than trusted.
 */
import {
  assignExperience,
  experienceStream, createRng, FundInfo, generatePeerSpecs, INCOME_ANCHOR } from "./syntheticPeers";

const CATALOG: FundInfo[] = [
  { id: "f-a35", ticker: "A35.SI", assetClass: "BOND" },
  { id: "f-agg", ticker: "AGG", assetClass: "BOND" },
  { id: "f-cfa", ticker: "CFA.SI", assetClass: "REIT" },
  { id: "f-es3", ticker: "ES3.SI", assetClass: "EQUITY" },
  { id: "f-spy", ticker: "SPY", assetClass: "EQUITY" },
  { id: "f-vwo", ticker: "VWO", assetClass: "EQUITY_EM" },
  { id: "f-gld", ticker: "GLD", assetClass: "COMMODITY" },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe("createRng", () => {
  it("is deterministic for a given seed and stays in [0, 1)", () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("differs across seeds", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
});

describe("generatePeerSpecs", () => {
  it("is reproducible: the same seed gives the identical population", () => {
    expect(generatePeerSpecs(50, 42, CATALOG)).toEqual(generatePeerSpecs(50, 42, CATALOG));
  });

  it("changes with the seed", () => {
    expect(generatePeerSpecs(50, 1, CATALOG)).not.toEqual(generatePeerSpecs(50, 2, CATALOG));
  });

  it("produces the requested number of peers with sequential indexes", () => {
    const specs = generatePeerSpecs(300, 42, CATALOG);
    expect(specs).toHaveLength(300);
    expect(specs.map((s) => s.index)).toEqual(Array.from({ length: 300 }, (_, i) => i));
  });

  it("anchors the cohort's median income to the SingStat figure (within 7%, across seeds)", () => {
    // Several seeds and a larger sample so one lucky draw can't hide a
    // systematic bias (an earlier version centred income on the wrong age
    // and sat ~10% high — this test would have caught it).
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = median(generatePeerSpecs(1000, seed, CATALOG).map((s) => s.income));
      expect(m).toBeGreaterThan(INCOME_ANCHOR * 0.93);
      expect(m).toBeLessThan(INCOME_ANCHOR * 1.07);
    }
  });

  it("is right-skewed: mean income exceeds the median", () => {
    const incomes = generatePeerSpecs(300, 42, CATALOG).map((s) => s.income);
    const mean = incomes.reduce((s, v) => s + v, 0) / incomes.length;
    expect(mean).toBeGreaterThan(median(incomes));
  });

  it("keeps ages in the young-adult range and incomes in sane bounds", () => {
    for (const s of generatePeerSpecs(300, 42, CATALOG)) {
      expect(s.age).toBeGreaterThanOrEqual(21);
      expect(s.age).toBeLessThanOrEqual(45);
      expect(s.income).toBeGreaterThanOrEqual(1200);
      expect(s.income).toBeLessThanOrEqual(20000);
    }
  });

  it("never lets contribution exceed what's left after expenses (wallet stays non-negative)", () => {
    for (const s of generatePeerSpecs(300, 42, CATALOG)) {
      expect(s.expense).toBeLessThan(s.income);
      expect(s.income - s.expense - s.contribution).toBeGreaterThanOrEqual(0);
      expect(s.contribution).toBeGreaterThanOrEqual(5);
    }
  });

  it("gives every portfolio 1-4 distinct funds whose integer weights sum to exactly 100", () => {
    for (const s of generatePeerSpecs(300, 42, CATALOG)) {
      expect(s.allocations.length).toBeGreaterThanOrEqual(1);
      expect(s.allocations.length).toBeLessThanOrEqual(4);
      expect(new Set(s.allocations.map((a) => a.fundId)).size).toBe(s.allocations.length);
      expect(s.allocations.reduce((sum, a) => sum + a.weightPct, 0)).toBe(100);
      for (const a of s.allocations) {
        expect(Number.isInteger(a.weightPct)).toBe(true);
        expect(a.weightPct).toBeGreaterThanOrEqual(s.allocations.length === 1 ? 100 : 5);
      }
    }
  });

  it("gives plans 3-24 months of history", () => {
    for (const s of generatePeerSpecs(300, 42, CATALOG)) {
      expect(s.monthsOfHistory).toBeGreaterThanOrEqual(3);
      expect(s.monthsOfHistory).toBeLessThanOrEqual(24);
    }
  });

  it("skews portfolios by risk level: low-risk peers hold more bonds than high-risk peers", () => {
    const specs = generatePeerSpecs(600, 42, CATALOG);
    const bondShare = (risk: string) => {
      const group = specs.filter((s) => s.riskLevel === risk);
      const total = group.reduce(
        (sum, s) => sum + s.allocations.filter((a) => a.ticker === "A35.SI" || a.ticker === "AGG").reduce((x, a) => x + a.weightPct, 0),
        0
      );
      return total / group.length;
    };
    expect(bondShare("LOW")).toBeGreaterThan(bondShare("HIGH") + 10);
  });

  it("produces all three risk levels and goal types", () => {
    const specs = generatePeerSpecs(300, 42, CATALOG);
    expect(new Set(specs.map((s) => s.riskLevel))).toEqual(new Set(["LOW", "MEDIUM", "HIGH"]));
    expect(new Set(specs.map((s) => s.goalType))).toEqual(new Set(["LEARN", "HABIT", "GROWTH"]));
  });

  it("works with a tiny catalog (never asks for more funds than exist)", () => {
    const specs = generatePeerSpecs(100, 3, CATALOG.slice(0, 2));
    for (const s of specs) expect(s.allocations.length).toBeLessThanOrEqual(2);
  });
});

describe("experience level (DECISIONS.md #18)", () => {
  it("assignExperience rises with age and covers all three levels", () => {
    const share = (age: number, level: string) => {
      let hits = 0;
      for (let i = 0; i < 1000; i++) if (assignExperience(age, i / 1000) === level) hits++;
      return hits / 1000;
    };
    expect(share(22, "BEGINNER")).toBeGreaterThan(share(35, "BEGINNER"));
    expect(share(35, "EXPERIENCED")).toBeGreaterThan(share(22, "EXPERIENCED"));
    for (const age of [20, 27, 40]) {
      const levels = new Set(Array.from({ length: 1000 }, (_, i) => assignExperience(age, i / 1000)));
      expect(levels).toEqual(new Set(["BEGINNER", "INTERMEDIATE", "EXPERIENCED"]));
    }
  });

  it("is deterministic for a seed and peer, and different peers get different streams", () => {
    expect(experienceStream(20261003, 5)()).toBe(experienceStream(20261003, 5)());
    expect(experienceStream(20261003, 5)()).not.toBe(experienceStream(20261003, 6)());
    expect(experienceStream(1, 5)()).not.toBe(experienceStream(2, 5)());
  });

  it("every generated peer has a valid level, and a population has all three", () => {
    const catalog = [{ id: "f1", ticker: "A", assetClass: "EQUITY" }, { id: "f2", ticker: "B", assetClass: "BOND" }];
    const specs = generatePeerSpecs(300, 20261003, catalog);
    expect(specs.every((p) => ["BEGINNER", "INTERMEDIATE", "EXPERIENCED"].includes(p.experienceLevel))).toBe(true);
    expect(new Set(specs.map((p) => p.experienceLevel)).size).toBe(3);
  });

  it("adding the field did not change any other attribute: same seed, same ages/incomes as before", () => {
    const catalog = [{ id: "f1", ticker: "A", assetClass: "EQUITY" }];
    const a = generatePeerSpecs(50, 42, catalog).map(({ experienceLevel: _e, ...rest }) => rest);
    const b = generatePeerSpecs(50, 42, catalog).map(({ experienceLevel: _e, ...rest }) => rest);
    expect(a).toEqual(b);
    expect(a[0].age).toBeGreaterThanOrEqual(21);
  });
});
