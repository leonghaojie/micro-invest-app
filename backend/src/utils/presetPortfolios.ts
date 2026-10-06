/**
 * Preset portfolios (DECISIONS.md #16, revised by #28): the ready-made mixes every user can buy,
 * defined as weighted allocations over the funds in prisma/fund-catalog.json, three or more in each
 * risk level so the Portfolios tab can group them as Low, Medium and High risk. Each has a
 * short description for its page (what it is, who it suits, what the risks are), kept here
 * with the allocation so the two cannot drift apart. Pure data, so a test can check every one is
 * well-formed (weights add to 100, every ticker exists in the catalog) without a database.
 *
 * The three original single-fund presets (Conservative, Balanced, Growth) are retired (#28): a single
 * fund is bought from the Funds tab, and accounts are ledgers of fund purchases that no longer
 * point at a portfolio. RETIRED_PRESETS says what each one was so anything still pointing at one
 * (a monthly buy) can be turned into the fund itself; see retiredPresets.service.ts. Names are the
 * identity the seed matches on, so renaming a preset would create a duplicate.
 */

export type PresetRisk = "LOW" | "MEDIUM" | "HIGH";

export interface PresetAllocation {
  ticker: string;
  weightPct: number;
}

/** What a preset's page says about it. Descriptive only: past behaviour and what the mix holds, never a forecast. */
export interface PresetInfo {
  /** One line for the list. */
  tagline: string;
  /** Three short points about what it is. */
  highlights: [string, string, string];
  /** Who it tends to suit, in a sentence. */
  suits: string;
  /** What can go wrong with this kind of mix, in a sentence or two. */
  riskNote: string;
}

export interface PresetDef {
  name: string;
  riskLevel: PresetRisk;
  allocations: PresetAllocation[];
  info: PresetInfo;
}

export const PRESET_PORTFOLIOS: PresetDef[] = [
  // ── Low risk ─────────────────────────────────────────────────────────
  {
    name: "Capital Preservation",
    riskLevel: "LOW",
    allocations: [
      { ticker: "BIL", weightPct: 40 }, // 1-3 month T-bills: the cash-like core
      { ticker: "AGG", weightPct: 30 },
      { ticker: "A35.SI", weightPct: 20 },
      { ticker: "GLD", weightPct: 10 },
    ],
    info: {
      tagline: "Protect your money first, with T-bills, bonds and a little gold",
      highlights: ["Most of it in T-bills and bonds, which move the least", "A small slice of gold as a cushion in a crisis", "Holds US and Singapore funds"],
      suits: "Money you may need soon, or someone who would rather see small, steady moves than larger swings.",
      riskNote: "Bond prices fall when interest rates rise, and in a rate shock a mix like this can fall for months before recovering. It is low risk, not zero risk.",
    },
  },
  {
    name: "Singapore Bonds",
    riskLevel: "LOW",
    allocations: [
      { ticker: "A35.SI", weightPct: 50 },
      { ticker: "MBH.SI", weightPct: 30 },
      { ticker: "BIL", weightPct: 20 },
    ],
    info: {
      tagline: "Singapore dollar bonds for steady income close to home",
      highlights: ["Half in a Singapore bond index fund", "A third in Singapore dollar corporate bonds", "The rest in short-term US T-bills"],
      suits: "Someone who wants income from bonds and prefers most of it in Singapore dollars.",
      riskNote: "Corporate bonds can lose value if a company's credit weakens, and the T-bills are in US dollars, so their value moves with the exchange rate.",
    },
  },
  {
    name: "Stable Income",
    riskLevel: "LOW",
    allocations: [
      { ticker: "AGG", weightPct: 30 },
      { ticker: "TIP", weightPct: 25 },
      { ticker: "MBH.SI", weightPct: 25 },
      { ticker: "LQD", weightPct: 20 },
    ],
    info: {
      tagline: "Bonds across government, inflation-linked and corporate for steady income",
      highlights: ["US bonds across the whole market", "Government bonds that adjust with inflation", "Investment-grade corporate bonds in the US and Singapore"],
      suits: "Someone who wants bonds only, spread over several kinds so no single one decides the result.",
      riskNote: "Rising interest rates push all of these down together, and corporate bonds add credit risk. A 100% bond mix has no shares to lift it in a rally.",
    },
  },

  // ── Medium risk ──────────────────────────────────────────────────────
  {
    name: "Global 60/40",
    riskLevel: "MEDIUM",
    allocations: [
      { ticker: "VT", weightPct: 60 },
      { ticker: "AGG", weightPct: 40 },
    ],
    info: {
      tagline: "The classic mix: 60% world stocks, 40% bonds",
      highlights: ["Stocks from around the world for growth", "Bonds to soften the falls", "Only two funds, easy to follow"],
      suits: "Someone who wants growth but would find a full stock-market fall hard to sit through.",
      riskNote: "Stocks and bonds sometimes fall together, as in 2022, and the stock half can lose a lot in a downturn.",
    },
  },
  {
    name: "Singapore Income",
    riskLevel: "MEDIUM",
    allocations: [
      { ticker: "A35.SI", weightPct: 30 },
      { ticker: "MBH.SI", weightPct: 20 },
      { ticker: "ES3.SI", weightPct: 30 },
      { ticker: "CLR.SI", weightPct: 20 },
    ],
    info: {
      tagline: "Singapore stocks, bonds and REITs for income in Singapore dollars",
      highlights: ["Bonds for stability", "Singapore blue-chip stocks", "Singapore REITs, which pay out most of their income"],
      suits: "Someone who wants their money in Singapore dollars and likes regular payouts.",
      riskNote: "Everything is tied to one small market, and REITs and bonds both react to interest rates.",
    },
  },
  {
    // Risk-balanced across growth, deflation, inflation: stocks, long and intermediate bonds, gold, commodities.
    name: "All-Weather",
    riskLevel: "MEDIUM",
    allocations: [
      { ticker: "VT", weightPct: 30 },
      { ticker: "TLT", weightPct: 40 },
      { ticker: "AGG", weightPct: 15 },
      { ticker: "GLD", weightPct: 8 },
      { ticker: "DBC", weightPct: 7 },
    ],
    info: {
      tagline: "Built to hold up whether growth, inflation or recession comes",
      highlights: ["Stocks for growth", "Long and medium-term bonds for recessions", "Gold and commodities for inflation"],
      suits: "Someone who does not want to bet on one kind of economy.",
      riskNote: "The long-term bonds can fall sharply when interest rates rise, and this mix lags a strong stock market.",
    },
  },
  {
    name: "Dividend & Income",
    riskLevel: "MEDIUM",
    allocations: [
      { ticker: "SCHD", weightPct: 35 },
      { ticker: "LQD", weightPct: 25 },
      { ticker: "VNQ", weightPct: 20 },
      { ticker: "CLR.SI", weightPct: 20 },
    ],
    info: {
      tagline: "Dividend stocks, corporate bonds and REITs that pay out regularly",
      highlights: ["US stocks with a record of paying dividends", "Investment-grade corporate bonds", "US and Singapore REITs"],
      suits: "Someone who values regular payouts over the fastest growth.",
      riskNote: "REITs and bonds both fall when interest rates rise, and payouts are not guaranteed.",
    },
  },

  // ── High risk ────────────────────────────────────────────────────────
  {
    name: "Global Equity",
    riskLevel: "HIGH",
    allocations: [
      { ticker: "VT", weightPct: 60 },
      { ticker: "QQQ", weightPct: 25 },
      { ticker: "VWO", weightPct: 15 },
    ],
    info: {
      tagline: "World stocks with extra weight on tech and emerging markets",
      highlights: ["Stocks from around the world", "A tilt to large US technology companies", "A share in emerging markets for growth"],
      suits: "Someone with many years ahead who can sit through large falls.",
      riskNote: "All of it is in shares, so it can fall 30% or more in a downturn, and it can take years to recover.",
    },
  },
  {
    name: "Asia Growth",
    riskLevel: "HIGH",
    allocations: [
      { ticker: "ES3.SI", weightPct: 25 },
      { ticker: "MCHI", weightPct: 25 },
      { ticker: "INDA", weightPct: 25 },
      { ticker: "VWO", weightPct: 25 },
    ],
    info: {
      tagline: "Singapore, China, India and emerging-market stocks",
      highlights: ["Singapore blue chips", "Chinese and Indian stocks", "A broad emerging-markets fund"],
      suits: "Someone who wants to invest in Asia's growth and accepts large swings.",
      riskNote: "Concentrated in a handful of economies, with currency and political risk on top of market risk.",
    },
  },
  {
    name: "US Growth",
    riskLevel: "HIGH",
    allocations: [
      { ticker: "QQQ", weightPct: 50 },
      { ticker: "SPY", weightPct: 30 },
      { ticker: "VT", weightPct: 20 },
    ],
    info: {
      tagline: "Large US growth companies, with the world market as a base",
      highlights: ["Half in the Nasdaq-100, tilted to technology", "A third in the S&P 500", "The rest in world stocks"],
      suits: "Someone who is comfortable with a concentrated bet on US growth companies and large swings.",
      riskNote: "A few very large technology companies drive much of the result, and growth stocks fall furthest when interest rates rise.",
    },
  },
];

/** What the retired single-fund presets were, so a monthly buy still pointing at one can become the fund itself. */
export const RETIRED_PRESETS = [
  { name: "Conservative", ticker: "A35.SI" },
  { name: "Balanced", ticker: "CFA.SI" },
  { name: "Growth", ticker: "ES3.SI" },
] as const;

/** The names of the retired presets (DECISIONS.md #28). */
export const RETIRED_PRESET_NAMES: readonly string[] = RETIRED_PRESETS.map((p) => p.name);

const infoByName = new Map(PRESET_PORTFOLIOS.map((p) => [p.name, p.info]));

/** A preset's page text by name, or null for a custom mix (whose name is free text the owner typed). */
export function presetInfo(name: string): PresetInfo | null {
  return infoByName.get(name) ?? null;
}
