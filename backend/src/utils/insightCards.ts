/**
 * Insight cards (DECISIONS.md #32): three plain-language cards that say where the user stands
 * among investors like them on portfolio value, savings rate and cash buffer. Pure: no
 * database, no clock. The service loads the members and hands them in.
 *
 * Peers come from the cohort engine (utils/peerCohort.ts), the same profile-only nearest
 * neighbours as the Peers tab, with weights chosen per card. This replaces the old income
 * bands (±10% widening), so every peer comparison in the app now picks peers the same way.
 *
 * The savings rate is (income - expenses) / income, which is exactly the engine's
 * "investment capacity" feature. Matching on it would compare people with the same savings
 * rate on their savings rate, so that card matches on income and life stage only.
 *
 * Descriptive only: a card states the user's figure, the peer median, the middle half and
 * where the user sits. It never suggests a contribution, an expense cut or any other action.
 */
import { capacityOf, describeBasis, Member, Population, selectPeers, summarize, Weights } from "./peerCohort";

export type InsightKey = "value" | "savingsRate" | "cashBuffer";

export interface InsightCard {
  key: InsightKey;
  title: string;
  status: "ok" | "unavailable" | "withheld";
  /** One or two sentences for the user. Always present. */
  body: string;
  unit: "currency" | "%" | "months";
  you?: number;
  median?: number;
  p25?: number;
  p75?: number;
  /** Where the user sits among the peers, 0-100 (mid-rank). */
  percentile?: number;
  /** How many investors the card compares against. */
  cohortSize?: number;
  /** "similar income and life stage" */
  basis: string;
}

export const INSIGHT_WEIGHTS: Record<InsightKey, Weights> = {
  // As the Peers tab's value row: size follows means and how long someone could have invested.
  value: { income: 0.4, capacity: 0.4, life: 0.2 },
  // Capacity left out on purpose: it IS the savings rate (see the header).
  savingsRate: { income: 0.6, life: 0.4 },
  // Cash builds up from what is left each month, so the same resources matter as for value.
  cashBuffer: { income: 0.4, capacity: 0.4, life: 0.2 },
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

interface CardDef {
  key: InsightKey;
  title: string;
  unit: InsightCard["unit"];
  /** The measure for one member, or null when it cannot be compared. */
  read: (m: Member) => number | null;
  /** Why the user has no figure, in words for them. */
  unavailable: (me: Member) => string;
  /** "Your portfolio is worth $1,234.56." */
  lead: (you: number) => string;
}

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${Math.round(v)}%`;
const months = (v: number) => `${v.toFixed(1)} month${round1(v) === 1 ? "" : "s"}`;

export const FORMAT: Record<InsightCard["unit"], (v: number) => string> = { currency: money, "%": pct, months };

const CARD_DEFS: CardDef[] = [
  {
    key: "value",
    title: "Portfolio value",
    unit: "currency",
    read: (m) => (m.value !== undefined && m.value > 0 ? round2(m.value) : null),
    // Value is as of the latest month-end, so a first purchase this month shows once that month's data arrives.
    unavailable: (me) =>
      me.holdings.length > 0
        ? "Your portfolio's value shows here once the month of your first purchase has ended and its fund data is in."
        : "Make your first investment to see how your portfolio's value compares.",
    lead: (v) => `Your portfolio is worth ${money(v)}.`,
  },
  {
    key: "savingsRate",
    title: "Savings rate",
    unit: "%",
    read: (m) => (m.income > 0 ? round2(capacityOf(m) * 100) : null),
    unavailable: () => "Add your monthly income to your profile to see your savings rate.",
    lead: (v) => `You keep ${pct(v)} of your income after your usual expenses.`,
  },
  {
    key: "cashBuffer",
    title: "Cash buffer",
    unit: "months",
    read: (m) => (m.cash !== undefined && m.expense > 0 ? round1(Math.max(0, m.cash) / m.expense) : null),
    unavailable: (me) =>
      me.expense > 0
        ? "Your cash buffer shows here once your first month with the app has ended and its fund data is in."
        : "Add your usual monthly expenses to your profile to see your cash buffer.",
    lead: (v) => `Your uninvested cash would cover ${months(v)} of your usual expenses.`,
  },
];

/** Within the middle half, or below / above it: a position, never a judgement. */
export function positionTitle(title: string, you: number, p25: number, p75: number): string {
  if (you < p25) return `${title}: below the middle of similar investors`;
  if (you > p75) return `${title}: above the middle of similar investors`;
  return `${title}: in the middle of similar investors`;
}

export function buildInsightCards(pop: Population, me: Member, opts: { minGroup: number; k?: number; minCohort?: number }): InsightCard[] {
  return CARD_DEFS.map((def): InsightCard => {
    const weights = INSIGHT_WEIGHTS[def.key];
    const basis = describeBasis(weights);
    const base = { key: def.key, unit: def.unit, basis };

    const mine = def.read(me);
    if (mine === null) return { ...base, title: def.title, status: "unavailable", body: def.unavailable(me) };

    const sel = selectPeers(pop, me, weights, { minGroup: opts.minGroup, k: opts.k, minCohort: opts.minCohort, hardRisk: false, eligible: (m) => def.read(m) !== null });
    if (sel.suppressed) {
      return { ...base, title: def.title, status: "withheld", body: `${def.lead(mine)} There are too few comparable investors to show how this compares privately.` };
    }

    const s = summarize(
      sel.peers.map((p) => def.read(p) as number),
      mine,
    );
    const fmt = FORMAT[def.unit];
    const body =
      `${def.lead(mine)} Among the ${s.n} investors closest to you in ${basis.replace(/^similar /, "")}, ` +
      `the median is ${fmt(s.median)} and the middle half are between ${fmt(s.p25)} and ${fmt(s.p75)}. ` +
      `You are higher than about ${s.percentile}% of them.`;
    return {
      ...base,
      title: positionTitle(def.title, mine, s.p25, s.p75),
      status: "ok",
      body,
      you: mine,
      median: s.median,
      p25: s.p25,
      p75: s.p75,
      percentile: s.percentile,
      cohortSize: s.n,
    };
  });
}
