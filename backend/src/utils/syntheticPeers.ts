/**
 * Synthetic peer generator — DECISIONS.md #9 (peer dashboard views).
 *
 * Pure and seeded: the same seed always produces the same population, so a
 * seed run is reproducible (in the spirit of NFR-04). prisma/seed.ts turns
 * these specs into users, profiles, custom portfolios and plans.
 *
 * What is calibrated to published data, and what is an ASSUMPTION — kept
 * explicit because this population feeds every peer statistic the app shows:
 *
 *  - INCOME (calibrated): the cohort median is anchored to SingStat's median
 *    monthly household employment income per household member, S$3,615 in
 *    2024 ("Key Household Income Trends, 2024"). The shape (right-skewed,
 *    lognormal) and the mild rise with age are modelling choices. Caveat:
 *    that statistic covers all ages, not the young-adult audience this app
 *    targets, so it is a defensible scale rather than a measured cohort.
 *  - EXPENSE RATIO (assumption): SingStat's Household Expenditure Survey
 *    2023 reports average monthly household spending of S$5,931 against
 *    average household income of S$15,473 (~38%), but that is spending over
 *    GROSS household income from all sources, so it is not comparable to the
 *    take-home expense ratio this app uses. The ratio here is therefore an
 *    assumption (mean ~62%, falling gently with income), not a measurement.
 *  - CONTRIBUTION RATE (assumption): median ~8% of income, capped so the
 *    wallet never goes negative.
 *  - AGE, RISK LEVEL, GOAL, START MONTH, PORTFOLIO MIX (assumptions): chosen
 *    to give the segmentation and allocation views realistic variety.
 */

export const INCOME_ANCHOR = 3615; // S$, SingStat 2024 median per household member

// Ages are drawn from triangular(21, 27, 45), whose mean is (21+27+45)/3 = 31.
// Income is centred on THIS age so the cohort's median lands on the anchor —
// centring on the mode instead skews the whole population ~10% high.
const COHORT_MEAN_AGE = 31;

export type RiskLevelName = "LOW" | "MEDIUM" | "HIGH";
export type GoalTypeName = "LEARN" | "HABIT" | "GROWTH";

export interface FundInfo {
  id: string;
  ticker: string;
  assetClass: string;
}

export interface SyntheticAllocation {
  fundId: string;
  ticker: string;
  weightPct: number; // integer, all of a portfolio's weights sum to 100
}

export interface SyntheticPeerSpec {
  index: number;
  age: number;
  income: number;
  expense: number;
  riskLevel: RiskLevelName;
  goalType: GoalTypeName;
  contribution: number;
  /** How many months of plan history this peer has (>= 3). */
  monthsOfHistory: number;
  allocations: SyntheticAllocation[];
}

/** mulberry32 — a tiny, well-known seeded PRNG returning floats in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Triangular distribution on [min, max] with the given mode (inverse CDF). */
function triangular(rng: () => number, min: number, mode: number, max: number): number {
  const u = rng();
  const fc = (mode - min) / (max - min);
  return u < fc
    ? min + Math.sqrt(u * (max - min) * (mode - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function pickWeighted<T>(rng: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// How strongly each risk level favours each asset class when picking funds.
const CLASS_AFFINITY: Record<RiskLevelName, Record<string, number>> = {
  LOW: { BOND: 5, REIT: 1, EQUITY: 1, EQUITY_EM: 0.3, COMMODITY: 1 },
  MEDIUM: { BOND: 2, REIT: 1.5, EQUITY: 3, EQUITY_EM: 1, COMMODITY: 1 },
  HIGH: { BOND: 0.5, REIT: 1, EQUITY: 4, EQUITY_EM: 2, COMMODITY: 1.5 },
};

const HOLDING_COUNT_WEIGHTS = [0.25, 0.35, 0.25, 0.15]; // P(1, 2, 3, 4 funds)
const MIN_WEIGHT_PCT = 5;

/** Splits 100 into `n` integer weights, each >= MIN_WEIGHT_PCT, using the
 * largest-remainder method so they always sum to exactly 100. */
function splitWeights(raw: number[]): number[] {
  const n = raw.length;
  if (n === 1) return [100];
  const total = raw.reduce((s, w) => s + w, 0);
  const spare = 100 - MIN_WEIGHT_PCT * n;
  const exact = raw.map((w) => MIN_WEIGHT_PCT + (w / total) * spare);
  const floors = exact.map(Math.floor);
  let remainder = 100 - floors.reduce((s, w) => s + w, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0; k = (k + 1) % n, remainder--) floors[order[k].i] += 1;
  return floors;
}

function buildAllocations(rng: () => number, risk: RiskLevelName, catalog: FundInfo[]): SyntheticAllocation[] {
  const affinity = CLASS_AFFINITY[risk];
  const holdingCount = Math.min(
    catalog.length,
    pickWeighted(rng, [1, 2, 3, 4], HOLDING_COUNT_WEIGHTS)
  );

  // Draw funds without replacement, proportional to their class affinity.
  const pool = [...catalog];
  const chosen: FundInfo[] = [];
  while (chosen.length < holdingCount && pool.length > 0) {
    const fund = pickWeighted(rng, pool, pool.map((f) => affinity[f.assetClass] ?? 1));
    chosen.push(fund);
    pool.splice(pool.indexOf(fund), 1);
  }

  const raw = chosen.map((f) => (0.5 + rng()) * (affinity[f.assetClass] ?? 1));
  const weights = splitWeights(raw);
  return chosen.map((f, i) => ({ fundId: f.id, ticker: f.ticker, weightPct: weights[i] }));
}

/** Generates `count` reproducible synthetic peer specs. */
export function generatePeerSpecs(count: number, seed: number, catalog: FundInfo[]): SyntheticPeerSpec[] {
  const rng = createRng(seed);
  const specs: SyntheticPeerSpec[] = [];

  for (let index = 0; index < count; index++) {
    const age = Math.round(triangular(rng, 21, 27, 45));

    // Income: SingStat-anchored median at the cohort's mean age, rising ~2%
    // per year of age, right-skewed (lognormal, sigma 0.5).
    const ageFactor = 1 + 0.02 * (age - COHORT_MEAN_AGE);
    const income = Math.round(clamp(INCOME_ANCHOR * ageFactor * Math.exp(0.5 * normal(rng)), 1200, 20000));

    // Expense ratio (ASSUMPTION): mean ~62%, falling gently with income.
    const ratio = clamp(0.62 - 0.08 * Math.log(income / INCOME_ANCHOR) + 0.08 * normal(rng), 0.25, 0.9);
    const expense = Math.round(income * ratio);
    const savings = income - expense;

    // Contribution (ASSUMPTION): median ~8% of income, never more than 60% of
    // what's left after expenses, so the wallet stays positive.
    const wantedRate = 0.08 * Math.exp(0.5 * normal(rng));
    const contribution = Math.max(5, Math.round(Math.min(income * wantedRate, savings * 0.6)));

    const youngBias = age <= 30;
    const riskLevel = pickWeighted<RiskLevelName>(
      rng,
      ["LOW", "MEDIUM", "HIGH"],
      youngBias ? [0.2, 0.45, 0.35] : [0.3, 0.5, 0.2]
    );
    const goalType = pickWeighted<GoalTypeName>(rng, ["LEARN", "HABIT", "GROWTH"], [0.3, 0.4, 0.3]);

    specs.push({
      index,
      age,
      income,
      expense,
      riskLevel,
      goalType,
      contribution,
      monthsOfHistory: 3 + Math.floor(rng() * 22), // 3..24
      allocations: buildAllocations(rng, riskLevel, catalog),
    });
  }

  return specs;
}
