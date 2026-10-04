/**
 * Preset portfolios (DECISIONS.md #16): the quick-start portfolios every user can
 * pick, defined as weighted allocations over the funds in prisma/fund-catalog.json.
 * Pure data, so a test can check every one is well-formed (weights add to 100,
 * every ticker exists in the catalog) without a database.
 *
 * The first three are the original single-fund presets. They are kept EXACTLY as
 * they were: a plan points at its portfolio and is recomputed on read, so changing
 * a preset's funds would silently rewrite the results of every plan using it. New
 * presets are added alongside, never in place of these. (Names are the identity
 * the seed matches on, so renaming one would create a duplicate.)
 */

export type PresetRisk = "LOW" | "MEDIUM" | "HIGH";

export interface PresetAllocation {
  ticker: string;
  weightPct: number;
}

export interface PresetDef {
  name: string;
  riskLevel: PresetRisk;
  allocations: PresetAllocation[];
}

export const PRESET_PORTFOLIOS: PresetDef[] = [
  // Original single-fund presets - do not change (see above).
  { name: "Conservative", riskLevel: "LOW", allocations: [{ ticker: "A35.SI", weightPct: 100 }] },
  { name: "Balanced", riskLevel: "MEDIUM", allocations: [{ ticker: "CFA.SI", weightPct: 100 }] },
  { name: "Growth", riskLevel: "HIGH", allocations: [{ ticker: "ES3.SI", weightPct: 100 }] },

  // Diversified presets.
  {
    name: "Capital Preservation",
    riskLevel: "LOW",
    allocations: [
      { ticker: "BIL", weightPct: 40 }, // 1-3 month T-bills: the cash-like core
      { ticker: "AGG", weightPct: 30 },
      { ticker: "A35.SI", weightPct: 20 },
      { ticker: "GLD", weightPct: 10 },
    ],
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
  },
  {
    name: "Global 60/40",
    riskLevel: "MEDIUM",
    allocations: [
      { ticker: "VT", weightPct: 60 },
      { ticker: "AGG", weightPct: 40 },
    ],
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
  },
  {
    name: "Global Equity",
    riskLevel: "HIGH",
    allocations: [
      { ticker: "VT", weightPct: 60 },
      { ticker: "QQQ", weightPct: 25 },
      { ticker: "VWO", weightPct: 15 },
    ],
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
  },
];

/** The names of the original presets, which must never change (see the file header). */
export const LEGACY_PRESET_NAMES = ["Conservative", "Balanced", "Growth"] as const;
