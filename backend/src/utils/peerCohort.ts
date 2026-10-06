/**
 * Peer cohort engine (DECISIONS.md #18), after "Peer Comparison Banding Framework".
 * Pure: no database, no clock. The service fetches members and hands them in.
 *
 *   hard filters -> normalised features -> weighted distance -> K nearest -> statistics
 *
 * Core idea from the framework: do not ask "which demographic group is this user in?"
 * but "for THIS metric, which investors make the comparison fair?" So every metric has
 * its own weights (and, for returns, a hard same-risk filter), and the nearest K
 * investors to the user under those weights are the peer set for that one card.
 *
 * Peers are matched ONLY on who the person is (their profile), never on what their
 * investing has produced: portfolio value, holdings, returns and contributions are the
 * things being compared, so matching on them would be circular (5 Oct 2026 revision).
 * Mapped to what the app actually knows (the framework names more variables than the
 * app collects; this is where it differs, and why):
 *   income                       monthly income, as a percentile of everyone
 *   investment capacity          (income - expense) / income, as a percentile. The
 *                                framework also lists obligations and income stability,
 *                                which the app does not collect.
 *   life stage                   age (continuous), shown to the user as a label
 *   risk profile                 the profile's risk level
 *   investment experience        NOT used: still stored on the profile, held back as a
 *                                filter for a future feature
 *   goal / goal horizon          NOT used: the app has a goal type but no goal amount or
 *                                horizon, so "goal progress" cannot be computed honestly
 *   investment consistency       the share of the last 12 months (since the first buy) with a
 *                                buy, now that buying is the user's own act (DECISIONS.md #19)
 *
 * Statistics are medians, quartiles and the user's mid-rank percentile within the
 * selected peers, and a peer set smaller than the privacy floor is withheld entirely.
 */

// ── Types ───────────────────────────────────────────────────────────────

export type Risk = "LOW" | "MEDIUM" | "HIGH";

export interface Member {
  /** Internal key for tie-breaking and excluding the user. Never returned to a client. */
  id: string;
  age: number;
  income: number;
  expense: number;
  risk: Risk;
  /** Monthly contribution. A compared outcome, not a matching feature. */
  contribution: number;
  /**
   * Share of the last 12 months (since their first buy) in which they bought something, or
   * null with too little history (utils/ledger.ts). A compared outcome, not a matching feature.
   */
  consistencyPct: number | null;
  /** One entry per fund: its asset class and weight as a fraction (the weights sum to 1). */
  /** ticker and name identify the fund for the "what peers hold" summary; they are never returned per person. */
  holdings: { assetClass: string; weight: number; ticker?: string; name?: string }[];
  /** The portfolio's monthly return (a fraction) by month, "YYYY-MM". Recent months only. */
  monthlyReturns: Record<string, number>;
}

export type MetricKey = "investmentRate" | "consistency" | "diversification" | "return" | "returnPerRisk";

type Feature = "income" | "capacity" | "life" | "risk";
export type Weights = Partial<Record<Feature, number>>;

// ── Weights (framework §4-5) ───────────────────────────────────────────

/** General-purpose weights, for the "your peer group" identity of the user. */
export const GENERAL_WEIGHTS: Weights = { income: 0.35, capacity: 0.35, life: 0.2, risk: 0.1 };

export const METRIC_WEIGHTS: Record<MetricKey, Weights> = {
  // Contribution / saving behaviour: financial resources matter, risk barely does.
  investmentRate: { income: 0.4, capacity: 0.4, life: 0.2 },
  // How regularly someone invests is behaviour like how much: the same financial position matters.
  consistency: { income: 0.4, capacity: 0.4, life: 0.2 },
  // Diversification: how widely someone spreads money follows their risk appetite and means.
  diversification: { risk: 0.4, capacity: 0.3, income: 0.15, life: 0.15 },
  // Returns: compare mainly among people taking similar risk; with the hard same-risk
  // filter on, the rest orders those people by how alike their circumstances are.
  return: { risk: 0.5, life: 0.2, income: 0.15, capacity: 0.15 },
  returnPerRisk: { risk: 0.5, life: 0.2, income: 0.15, capacity: 0.15 },
};

/** Return comparisons are only meaningful among people taking similar risk (framework §2). */
const HARD_RISK: Record<MetricKey, boolean> = { investmentRate: false, consistency: false, diversification: false, return: true, returnPerRisk: true };

/** An age gap of this many years counts as "completely different" for life stage. */
export const LIFE_STAGE_SPAN_YEARS = 15;

export const DEFAULTS = {
  /** Peers kept per comparison (framework §6: hundreds at scale; the app's population is small). */
  k: 50,
  /** Below this many eligible peers, relax the hard filter one step (framework §9). */
  minCohort: 30,
};

// ── Small numeric helpers ──────────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const RISK_ORDER: Record<Risk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** q in [0, 1]; linear interpolation between ranks (as Postgres percentile_cont). `sorted` ascending. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = clamp01(q) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Share of `sorted` (ascending) below x, counting ties as half: mid-rank, in [0, 1]. */
export function midRank(sorted: number[], x: number): number {
  if (sorted.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < x) below += 1;
    else if (v === x) equal += 1;
  }
  return (below + equal / 2) / sorted.length;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

// ── Per-member measures ────────────────────────────────────────────────

/** Share of income that is left after expenses: how much the person can sustainably invest. */
export function capacityOf(m: Pick<Member, "income" | "expense">): number {
  return m.income > 0 ? (m.income - m.expense) / m.income : 0;
}

/** Monthly contribution as a percent of monthly income. */
export function investmentRatePct(m: Pick<Member, "contribution" | "income">): number | null {
  return m.income > 0 ? round2((m.contribution / m.income) * 100) : null;
}

const herfindahl = (shares: number[]) => shares.reduce((s, w) => s + w * w, 0);

function classShares(holdings: Member["holdings"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of holdings) out[h.assetClass] = (out[h.assetClass] ?? 0) + h.weight;
  return out;
}

/** The asset classes the catalog spreads over; the class score is full at an even split across them. */
const ASSET_CLASS_COUNT = 5;
/** Funds beyond this many add nothing to the fund-level score. */
const FUND_COUNT_CAP = 10;

/**
 * 0-100. How evenly the money is spread, over asset classes (60%) and over funds (40%):
 * 100 x (1 - concentration) rescaled so a full spread scores 100 and a single holding 0.
 * Limits worth stating: one broad fund (a total-world ETF) scores 0 here though it is
 * internally diversified, because the app does not hold the look-through of each fund.
 */
export function diversificationScore(holdings: Member["holdings"]): number {
  if (holdings.length === 0) return 0;
  const classScore = (1 - herfindahl(Object.values(classShares(holdings)))) / (1 - 1 / ASSET_CLASS_COUNT);
  const fundScore = (1 - herfindahl(holdings.map((h) => h.weight))) / (1 - 1 / FUND_COUNT_CAP);
  return Math.round(100 * clamp01(0.6 * clamp01(classScore) + 0.4 * clamp01(fundScore)));
}

/** Weight of the single biggest holding, as a percent. */
export function largestHoldingPct(holdings: Member["holdings"]): number {
  return holdings.length === 0 ? 0 : round1(Math.max(...holdings.map((h) => h.weight)) * 100);
}

/** "YYYY-MM" strings for the `n` months ending at `asOf`, oldest first. */
export function trailingMonths(asOf: string, n: number): string[] {
  const [y, m] = asOf.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The member's portfolio returns for exactly these months, or null if any month is missing. */
export function windowReturns(m: Pick<Member, "monthlyReturns">, months: string[]): number[] | null {
  const out: number[] = [];
  for (const month of months) {
    const r = m.monthlyReturns[month];
    if (r === undefined || !Number.isFinite(r)) return null;
    out.push(r);
  }
  return out;
}

/** Compounded return over the months, as a percent (time-weighted: contributions do not distort it). */
export function compoundedReturnPct(returns: number[]): number {
  return round2((returns.reduce((acc, r) => acc * (1 + r), 1) - 1) * 100);
}

/** The shortest window over which return-per-risk is meaningful. */
export const MIN_MONTHS_FOR_RISK_ADJUSTED = 6;

/**
 * Annualised return divided by annualised volatility (a Sharpe-like ratio with no
 * risk-free rate): how much return each unit of ups-and-downs bought. null if the window
 * is too short or the returns never moved.
 */
export function returnPerRisk(returns: number[]): number | null {
  const n = returns.length;
  if (n < MIN_MONTHS_FOR_RISK_ADJUSTED) return null;
  const growth = returns.reduce((acc, r) => acc * (1 + r), 1);
  const annualReturn = Math.pow(growth, 12 / n) - 1;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1);
  const annualVol = Math.sqrt(variance) * Math.sqrt(12);
  return annualVol > 1e-9 ? round2(annualReturn / annualVol) : null;
}

// ── Benchmark ──────────────────────────────────────────────────────────

export interface BenchmarkDef {
  label: string;
  /** ticker -> weight (fractions summing to 1) */
  mix: Record<string, number>;
}

/**
 * A market benchmark for each risk level: a stock/bond blend of two broad index funds,
 * rebalanced monthly (the same way the app's own plans are). Stocks are VT (total world),
 * bonds are AGG (US aggregate bonds).
 */
export const BENCHMARKS: Record<Risk, BenchmarkDef> = {
  LOW: { label: "20% global stocks / 80% bonds", mix: { VT: 0.2, AGG: 0.8 } },
  MEDIUM: { label: "60% global stocks / 40% bonds", mix: { VT: 0.6, AGG: 0.4 } },
  HIGH: { label: "100% global stocks", mix: { VT: 1 } },
};

/** Compounded benchmark return over the months, or null if any fund is missing any month. */
export function benchmarkReturnPct(risk: Risk, fundReturns: Record<string, Record<string, number>>, months: string[]): number | null {
  const mix = BENCHMARKS[risk].mix;
  const monthly: number[] = [];
  for (const month of months) {
    let r = 0;
    for (const [ticker, weight] of Object.entries(mix)) {
      const v = fundReturns[ticker]?.[month];
      if (v === undefined) return null;
      r += weight * v;
    }
    monthly.push(r);
  }
  return compoundedReturnPct(monthly);
}

// ── Population and distance ────────────────────────────────────────────

interface Features {
  income: number; // percentile 0..1
  capacity: number;
  risk: number; // 0, 0.5, 1
  age: number;
}

export interface Population {
  members: Member[];
  features: Map<string, Features>;
}

/** Normalises every member against everyone (framework §3.2): skewed amounts become percentiles. */
export function buildPopulation(members: Member[]): Population {
  const incomes = members.map((m) => m.income).sort((a, b) => a - b);
  const capacities = members.map(capacityOf).sort((a, b) => a - b);

  const features = new Map<string, Features>();
  for (const m of members) {
    features.set(m.id, {
      income: midRank(incomes, m.income),
      capacity: midRank(capacities, capacityOf(m)),
      risk: RISK_ORDER[m.risk] / 2,
      age: m.age,
    });
  }
  return { members, features };
}

/** Weighted similarity distance D(i,j) = sum of w_k * d_k, each d_k in [0, 1] (framework §3.3). */
export function distance(weights: Weights, a: Features, b: Features): number {
  let d = 0;
  if (weights.income) d += weights.income * Math.abs(a.income - b.income);
  if (weights.capacity) d += weights.capacity * Math.abs(a.capacity - b.capacity);
  if (weights.risk) d += weights.risk * Math.abs(a.risk - b.risk);
  if (weights.life) d += weights.life * Math.min(1, Math.abs(a.age - b.age) / LIFE_STAGE_SPAN_YEARS);
  return d;
}

// ── Peer selection ─────────────────────────────────────────────────────

export interface Selection {
  /** The nearest eligible members, closest first. */
  peers: Member[];
  /** How the hard filter had to be loosened, in plain words; empty if it did not. */
  relaxations: string[];
  /** The hard filter that was finally applied ("same risk level", "adjacent risk levels"), or null. */
  filter: string | null;
  /** Withheld: fewer than the privacy floor of eligible peers, even after loosening. */
  suppressed: boolean;
  /** Fewer than the preferred minimum cohort, but enough to show. */
  small: boolean;
}

interface SelectOptions {
  k: number;
  minCohort: number;
  /** The privacy floor: never describe a group smaller than this (NFR-03). */
  minGroup: number;
}

/** The ladder of hard filters, strictest first (framework §9: relax the least important constraint first). */
const RISK_LADDER: { label: string | null; allows: (a: number, b: number) => boolean; relaxation: string | null }[] = [
  { label: "same risk level", allows: (a, b) => a === b, relaxation: null },
  { label: "adjacent risk levels", allows: (a, b) => Math.abs(a - b) <= 0.5, relaxation: "not enough investors at your exact risk level, so neighbouring risk levels were included" },
  { label: null, allows: () => true, relaxation: "not enough investors near your risk level, so all risk levels were included" },
];

/**
 * Picks the K members nearest to `me` under `weights`. `eligible` says whether a member
 * has the metric at all (e.g. enough months of history), and `hardRisk` makes the risk
 * level a requirement rather than just a weight.
 */
export function selectPeers(
  pop: Population,
  me: Member,
  weights: Weights,
  options: { hardRisk: boolean; eligible: (m: Member) => boolean } & Partial<SelectOptions> & { minGroup: number }
): Selection {
  // `?? DEFAULTS`, not a spread: a caller passing `k: undefined` must get the default,
  // not have the undefined overwrite it.
  const k = options.k ?? DEFAULTS.k;
  const minCohort = options.minCohort ?? DEFAULTS.minCohort;
  const minGroup = options.minGroup;
  const myF = pop.features.get(me.id)!;
  const others = pop.members.filter((m) => m.id !== me.id && options.eligible(m));

  const ladder = options.hardRisk ? RISK_LADDER : [{ label: null, allows: () => true, relaxation: null }];
  let chosen: Member[] = [];
  let level = 0;
  for (; level < ladder.length; level++) {
    chosen = others.filter((m) => ladder[level].allows(myF.risk, pop.features.get(m.id)!.risk));
    if (chosen.length >= minCohort) break;
  }
  if (level === ladder.length) level = ladder.length - 1; // never reached the preferred size: use the widest

  const nearest = chosen
    .map((m) => ({ m, d: distance(weights, myF, pop.features.get(m.id)!) }))
    .sort((x, y) => x.d - y.d || (x.m.id < y.m.id ? -1 : 1))
    .slice(0, k)
    .map((x) => x.m);

  const used = ladder[level];
  return {
    peers: nearest,
    relaxations: ladder.slice(1, level + 1).map((l) => l.relaxation as string),
    filter: used.label,
    suppressed: chosen.length < minGroup,
    small: chosen.length < minCohort,
  };
}

// ── Statistics ─────────────────────────────────────────────────────────

export interface Summary {
  n: number;
  median: number;
  p25: number;
  p75: number;
  /** Where `mine` sits among the peers, 0-100 (mid-rank; ties count half). */
  percentile: number;
  /** "Top X%": the share of peers at or above you, at least 1. */
  topPct: number;
}

export function summarize(values: number[], mine: number): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = Math.round(midRank(sorted, mine) * 100);
  return {
    n: sorted.length,
    median: round2(quantile(sorted, 0.5)),
    p25: round2(quantile(sorted, 0.25)),
    p75: round2(quantile(sorted, 0.75)),
    percentile,
    topPct: Math.max(1, 100 - percentile),
  };
}

// ── Plain-language descriptions (framework §10, §11: explainable) ──────

const FEATURE_NAMES: Record<Feature, string> = {
  income: "income",
  capacity: "investment capacity",
  life: "life stage",
  risk: "risk level",
};

/** "similar income, investment capacity and life stage": the features that count most for this metric. */
export function describeBasis(weights: Weights): string {
  const top = (Object.entries(weights) as [Feature, number][])
    .filter(([, w]) => w >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => FEATURE_NAMES[f]);
  if (top.length === 0) return "similar investors";
  const list = top.length === 1 ? top[0] : `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
  return `similar ${list}`;
}

export function lifeStageLabel(age: number): string {
  if (age < 26) return "Young investor";
  if (age < 36) return "Early-career investor";
  if (age < 51) return "Mid-career investor";
  return "Established investor";
}

const tier = (pct: number, labels: [string, string, string]) => (pct < 1 / 3 ? labels[0] : pct < 2 / 3 ? labels[1] : labels[2]);

export const RISK_LABEL: Record<Risk, string> = { LOW: "Conservative risk", MEDIUM: "Balanced risk", HIGH: "Growth risk" };

/** The broad identity cohort: a communication layer only, not the statistical engine (framework §10). */
export function identityLabels(pop: Population, me: Member): string[] {
  const f = pop.features.get(me.id)!;
  return [
    lifeStageLabel(me.age),
    tier(f.income, ["Lower income", "Mid income", "Higher income"]),
    tier(f.capacity, ["Lower investment capacity", "Moderate investment capacity", "High investment capacity"]),
    RISK_LABEL[me.risk],
  ];
}

export interface GroupDescription {
  size: number;
  ageRange: [number, number];
  /** The monthly contribution the middle 80% of the group make. */
  contributionRange: [number, number];
  /** Share of the group at each risk level, 0-100. */
  risk: Record<Risk, number>;
}

/** What the peer group looks like, from p10 to p90 so one outlier does not stretch a range. */
export function describeGroup(peers: Member[]): GroupDescription {
  const sortedBy = (f: (m: Member) => number) => peers.map(f).sort((a, b) => a - b);
  const ages = sortedBy((m) => m.age);
  const contributions = sortedBy((m) => m.contribution);
  const roundTo = (v: number, step: number) => Math.round(v / step) * step;
  const share = (r: Risk) => Math.round((peers.filter((m) => m.risk === r).length / peers.length) * 100);
  return {
    size: peers.length,
    ageRange: [Math.round(quantile(ages, 0.1)), Math.round(quantile(ages, 0.9))],
    contributionRange: [roundTo(quantile(contributions, 0.1), 10), roundTo(quantile(contributions, 0.9), 10)],
    risk: { LOW: share("LOW"), MEDIUM: share("MEDIUM"), HIGH: share("HIGH") },
  };
}

// ── The report ─────────────────────────────────────────────────────────

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
  /** How many investors the comparison is against. */
  cohortSize?: number;
  /** "similar income, investment capacity and life stage" */
  basis: string;
  /** The hard filter applied ("same risk level"), or null. */
  filter: string | null;
  /** How the filter had to be loosened, if it did. */
  relaxations: string[];
  /** A second figure that explains the first (e.g. the largest holding behind a diversification score). */
  detail?: { label: string; you: number; median: number; unit: "%" };
}

/** What the peers hold (DECISIONS.md #21): aggregate only, never one person's portfolio. */
export interface HoldingsSummary {
  /** How many peers it describes (all of them hold something). */
  peerCount: number;
  /** The peers' average share of each asset class, percent, largest first (adds up to 100). */
  peerMix: { assetClass: string; pct: number }[];
  /** The user's own mix, same shape. */
  myMix: { assetClass: string; pct: number }[];
  /** The funds most peers hold, with the share of peers that hold each. Only funds held by at least MIN_FUND_HOLDERS peers. */
  topFunds: { ticker: string; name: string; heldByPct: number; youHold: boolean }[];
  /** The average number of funds a peer holds, and how many the user holds. */
  avgFunds: number;
  myFunds: number;
}

/** A fund is listed only if at least this many peers hold it, so no list can describe one or two people. */
export const MIN_FUND_HOLDERS = 3;
/** The most funds listed. */
export const TOP_FUNDS_SHOWN = 6;

const mixOf = (holdings: Member["holdings"]): { assetClass: string; pct: number }[] =>
  Object.entries(classShares(holdings))
    .map(([assetClass, w]) => ({ assetClass, pct: round1(w * 100) }))
    .sort((a, b) => b.pct - a.pct || (a.assetClass < b.assetClass ? -1 : 1));

/**
 * What the peers hold, for the same people the diversification row compares you with: their
 * average asset-class mix, the funds held by the most of them, and how many funds they hold.
 * null with fewer peers than the privacy floor, or when the user holds nothing.
 */
export function summarizeHoldings(peers: Member[], me: Member, minGroup: number): HoldingsSummary | null {
  const withHoldings = peers.filter((p) => p.holdings.length > 0);
  if (withHoldings.length < minGroup || me.holdings.length === 0) return null;

  const totals: Record<string, number> = {};
  for (const p of withHoldings) for (const [c, w] of Object.entries(classShares(p.holdings))) totals[c] = (totals[c] ?? 0) + w;
  const peerMix = Object.entries(totals)
    .map(([assetClass, w]) => ({ assetClass, pct: round1((w / withHoldings.length) * 100) }))
    .sort((a, b) => b.pct - a.pct || (a.assetClass < b.assetClass ? -1 : 1));

  const holders = new Map<string, { name: string; count: number }>();
  for (const p of withHoldings) {
    for (const h of new Set(p.holdings.map((x) => x.ticker).filter((t): t is string => !!t))) {
      const name = p.holdings.find((x) => x.ticker === h)?.name ?? h;
      const e = holders.get(h) ?? { name, count: 0 };
      e.count += 1;
      holders.set(h, e);
    }
  }
  const mine = new Set(me.holdings.map((h) => h.ticker).filter((t): t is string => !!t));
  const topFunds = [...holders.entries()]
    .filter(([, e]) => e.count >= MIN_FUND_HOLDERS)
    .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_FUNDS_SHOWN)
    .map(([ticker, e]) => ({ ticker, name: e.name, heldByPct: Math.round((e.count / withHoldings.length) * 100), youHold: mine.has(ticker) }));

  return {
    peerCount: withHoldings.length,
    peerMix,
    myMix: mixOf(me.holdings),
    topFunds,
    avgFunds: round1(withHoldings.reduce((sum, p) => sum + p.holdings.length, 0) / withHoldings.length),
    myFunds: me.holdings.length,
  };
}

export interface CohortReport {
  /** Withheld entirely: the whole population is too small to describe anyone's peers. */
  suppressed: boolean;
  identity: string[];
  group: GroupDescription | null;
  headline: {
    windowMonths: number;
    you: number;
    peerMedian: number | null;
    peerCount: number;
    benchmark: { label: string; returnPct: number } | null;
  } | null;
  cards: Card[];
  /** What the peers behind the diversification row hold, or null. */
  holdings: HoldingsSummary | null;
  /** One neutral sentence on what stands out; never advice. */
  observation: string | null;
}

export interface ReportContext {
  /** The latest month the fund data runs to, "YYYY-MM": the end of every comparison window. */
  asOf: string;
  /** Monthly fund returns by ticker, for the benchmark. */
  fundReturns: Record<string, Record<string, number>>;
  minGroup: number;
  k?: number;
  minCohort?: number;
}

const MAX_WINDOW_MONTHS = 12;

/** The longest recent run (up to a year) of consecutive months the member has returns for. */
export function windowLength(m: Pick<Member, "monthlyReturns">, asOf: string): number {
  for (let n = MAX_WINDOW_MONTHS; n >= 1; n--) {
    if (windowReturns(m, trailingMonths(asOf, n)) !== null) return n;
  }
  return 0;
}

interface MetricDef {
  key: MetricKey;
  label: string;
  unit: Card["unit"];
}

const CARD_DEFS: MetricDef[] = [
  { key: "investmentRate", label: "Monthly investment rate", unit: "%" },
  { key: "consistency", label: "Contribution consistency", unit: "%" },
  { key: "diversification", label: "Diversification score", unit: "score" },
  { key: "return", label: "Portfolio return", unit: "%" },
  { key: "returnPerRisk", label: "Return per unit of risk", unit: "ratio" },
];

export function buildCohortReport(pop: Population, me: Member, ctx: ReportContext): CohortReport {
  const base = { minGroup: ctx.minGroup, k: ctx.k, minCohort: ctx.minCohort };
  const identity = identityLabels(pop, me);

  const general = selectPeers(pop, me, GENERAL_WEIGHTS, { ...base, hardRisk: false, eligible: () => true });
  if (general.suppressed) {
    return { suppressed: true, identity, group: null, headline: null, cards: [], holdings: null, observation: null };
  }

  const n = windowLength(me, ctx.asOf);
  const months = trailingMonths(ctx.asOf, Math.max(n, 1));
  const myReturns = n > 0 ? windowReturns(me, months) : null;

  // The people behind the diversification row: what they hold is what "people like you" invest in.
  let diversificationPeers: Member[] = [];

  const cards: Card[] = CARD_DEFS.map((def): Card => {
    const weights = METRIC_WEIGHTS[def.key];
    const card: Card = { key: def.key, label: def.label, unit: def.unit, status: "ok", basis: describeBasis(weights), filter: null, relaxations: [] };

    // How each metric reads off a member (null: the member cannot be compared on it).
    const value = (m: Member): number | null => {
      switch (def.key) {
        case "investmentRate":
          return investmentRatePct(m);
        case "consistency":
          return m.consistencyPct;
        case "diversification":
          return m.holdings.length === 0 ? null : diversificationScore(m.holdings);
        case "return": {
          const r = n > 0 ? windowReturns(m, months) : null;
          return r ? compoundedReturnPct(r) : null;
        }
        case "returnPerRisk": {
          const r = n > 0 ? windowReturns(m, months) : null;
          return r ? returnPerRisk(r) : null;
        }
      }
    };

    const mine = value(me);
    if (mine === null) {
      return {
        ...card,
        status: "unavailable",
        message:
          def.key === "return" || def.key === "returnPerRisk"
            ? def.key === "returnPerRisk" && n > 0
              ? `Needs at least ${MIN_MONTHS_FOR_RISK_ADJUSTED} months of history (you have ${n}).`
              : "Needs at least 1 full month of investing history."
            : def.key === "consistency"
              ? "Needs at least 3 months of investing to show how regularly you invest."
              : "Not available yet.",
      };
    }

    const sel = selectPeers(pop, me, weights, { ...base, hardRisk: HARD_RISK[def.key], eligible: (m) => value(m) !== null });
    if (sel.suppressed) {
      return { ...card, status: "withheld", message: "Too few comparable investors to show this privately.", filter: sel.filter, relaxations: sel.relaxations };
    }

    const peerValues = sel.peers.map((p) => value(p) as number);
    const s = summarize(peerValues, mine);
    const out: Card = { ...card, you: mine, median: s.median, p25: s.p25, p75: s.p75, percentile: s.percentile, topPct: s.topPct, cohortSize: s.n, filter: sel.filter, relaxations: sel.relaxations };
    // Risk level is pinned by the filter, so it is no longer something peers were matched "similar" on.
    if (sel.filter === "same risk level") out.basis = describeBasis({ ...weights, risk: 0 });

    if (def.key === "diversification") {
      diversificationPeers = sel.peers;
      const peerLargest = sel.peers.map((p) => largestHoldingPct(p.holdings)).sort((a, b) => a - b);
      out.detail = { label: "Largest holding", you: largestHoldingPct(me.holdings), median: round1(quantile(peerLargest, 0.5)), unit: "%" };
    }
    return out;
  });

  const returnCard = cards.find((c) => c.key === "return")!;
  const headline =
    returnCard.status === "ok" && myReturns
      ? {
          windowMonths: n,
          you: returnCard.you as number,
          peerMedian: returnCard.median ?? null,
          peerCount: returnCard.cohortSize ?? 0,
          benchmark: (() => {
            const pct = benchmarkReturnPct(me.risk, ctx.fundReturns, months);
            return pct === null ? null : { label: BENCHMARKS[me.risk].label, returnPct: pct };
          })(),
        }
      : null;

  return {
    suppressed: false,
    identity,
    group: describeGroup(general.peers),
    headline,
    cards,
    holdings: summarizeHoldings(diversificationPeers, me, ctx.minGroup),
    observation: buildObservation(cards),
  };
}

/** Within this many percentile points of the middle counts as "in line". */
const MIDDLE_BAND = 10;

/**
 * One neutral sentence about where the user stands: the measure they are furthest ahead
 * on and the one furthest behind. Descriptive only - it states a position and, for
 * diversification, the figure behind it, and never tells the user what to do.
 */
export function buildObservation(cards: Card[]): string | null {
  const ok = cards.filter((c) => c.status === "ok" && c.percentile !== undefined);
  if (ok.length === 0) return null;

  const by = [...ok].sort((a, b) => (b.percentile as number) - (a.percentile as number));
  const best = by[0];
  const worst = by[by.length - 1];
  const name = (c: Card) => c.label.toLowerCase();

  const ahead = (best.percentile as number) >= 50 + MIDDLE_BAND;
  const behind = (worst.percentile as number) <= 50 - MIDDLE_BAND;

  const behindText = (c: Card) =>
    c.key === "diversification" && c.detail
      ? `your portfolio is more concentrated than most (your largest holding is ${c.detail.you}% against a peer median of ${c.detail.median}%)`
      : `you are behind most of them on ${name(c)}`;

  if (ahead && behind && best !== worst) return `You are ahead of similar investors on ${name(best)}, but ${behindText(worst)}.`;
  if (ahead) return `You are ahead of similar investors on ${name(best)}, and not behind on anything else shown.`;
  if (behind) return `You are close to the middle on most measures, but ${behindText(worst)}.`;
  return "You are close to the middle of similar investors on every measure shown.";
}
