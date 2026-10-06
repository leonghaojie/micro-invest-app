/**
 * The fund catalog and the preset portfolios (DECISIONS.md #16): every preset is
 * well-formed and only uses funds that exist, and the original presets are
 * unchanged. Reads prisma/fund-catalog.json, the single source of truth that the
 * Python fetch also uses.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { presetInfo, PRESET_PORTFOLIOS, RETIRED_PRESETS, RETIRED_PRESET_NAMES } from "./presetPortfolios";

interface CatalogEntry {
  symbol: string;
  exchange: string;
  name: string;
  assetClass: string;
  currency: string;
}

const catalog: CatalogEntry[] = JSON.parse(readFileSync(join(__dirname, "..", "..", "prisma", "fund-catalog.json"), "utf-8"));
const bySymbol = new Map(catalog.map((c) => [c.symbol, c]));

describe("fund-catalog.json", () => {
  it("has the fields every fund needs", () => {
    for (const c of catalog) {
      expect(c.symbol).toMatch(/^[A-Z0-9]+(\.SI)?$/);
      expect(c.name.length).toBeGreaterThan(3);
      expect(["SGX", "US"]).toContain(c.exchange);
      expect(["SGD", "USD"]).toContain(c.currency);
      expect(["EQUITY", "EQUITY_EM", "BOND", "REIT", "COMMODITY"]).toContain(c.assetClass);
    }
  });

  it("has no duplicate symbols", () => {
    expect(new Set(catalog.map((c) => c.symbol)).size).toBe(catalog.length);
  });

  it("keeps exchange and currency consistent with the symbol (.SI is SGX in SGD; the rest US in USD)", () => {
    for (const c of catalog) {
      const sgx = c.symbol.endsWith(".SI");
      expect(c.exchange).toBe(sgx ? "SGX" : "US");
      expect(c.currency).toBe(sgx ? "SGD" : "USD");
    }
  });

  it("still contains the original eight funds", () => {
    for (const s of ["A35.SI", "CFA.SI", "ES3.SI", "G3B.SI", "SPY", "AGG", "VWO", "GLD"]) expect(bySymbol.has(s)).toBe(true);
  });

  it("covers every asset class", () => {
    expect(new Set(catalog.map((c) => c.assetClass)).size).toBe(5);
  });
});

describe("PRESET_PORTFOLIOS", () => {
  it("has unique, non-empty names", () => {
    const names = PRESET_PORTFOLIOS.map((p) => p.name);
    expect(names.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(PRESET_PORTFOLIOS.map((p) => [p.name, p] as const))("%s: weights are positive and add up to exactly 100", (_name, preset) => {
    expect(preset.allocations.length).toBeGreaterThan(0);
    for (const a of preset.allocations) expect(a.weightPct).toBeGreaterThan(0);
    expect(preset.allocations.reduce((sum, a) => sum + a.weightPct, 0)).toBe(100);
  });

  it.each(PRESET_PORTFOLIOS.map((p) => [p.name, p] as const))("%s: uses only catalog funds, each at most once", (_name, preset) => {
    const tickers = preset.allocations.map((a) => a.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
    for (const t of tickers) expect(bySymbol.has(t)).toBe(true);
  });

  it("no longer offers the three original single-fund presets, and knows which fund each was", () => {
    const names = PRESET_PORTFOLIOS.map((p) => p.name);
    for (const retired of RETIRED_PRESET_NAMES) expect(names).not.toContain(retired);
    expect(RETIRED_PRESETS.map((r) => [r.name, r.ticker])).toEqual([
      ["Conservative", "A35.SI"],
      ["Balanced", "CFA.SI"],
      ["Growth", "ES3.SI"],
    ]);
    for (const r of RETIRED_PRESETS) expect(bySymbol.has(r.ticker)).toBe(true); // each was one fund of the catalog
  });

  it("has at least three presets at each risk level, so every group on the Portfolios tab has a choice", () => {
    for (const risk of ["LOW", "MEDIUM", "HIGH"]) expect(PRESET_PORTFOLIOS.filter((p) => p.riskLevel === risk).length).toBeGreaterThanOrEqual(3);
  });

  it.each(PRESET_PORTFOLIOS.map((p) => [p.name, p] as const))("%s: has a page text: a tagline, three highlights, who it suits and a risk note", (_name, preset) => {
    expect(preset.info.tagline.length).toBeGreaterThan(10);
    expect(preset.info.highlights).toHaveLength(3);
    for (const h of preset.info.highlights) expect(h.trim().length).toBeGreaterThan(5);
    expect(preset.info.suits.length).toBeGreaterThan(10);
    expect(preset.info.riskNote.length).toBeGreaterThan(10);
  });

  it("describes only what a mix holds and how it behaves, and promises nothing", () => {
    for (const p of PRESET_PORTFOLIOS) {
      const text = [p.info.tagline, ...p.info.highlights, p.info.suits, p.info.riskNote].join(" ").toLowerCase();
      expect(text).not.toMatch(/(?<!not )guaranteed|risk-free|will earn|will grow|you should|we recommend/); // 'not guaranteed' is the honest wording
    }
  });

  it("looks a preset's text up by name, and has none for anything else (a custom mix's name is free text)", () => {
    expect(presetInfo("Global 60/40")?.tagline).toBe(PRESET_PORTFOLIOS.find((p) => p.name === "Global 60/40")!.info.tagline);
    expect(presetInfo("Conservative")).toBeNull();
    expect(presetInfo("My own mix")).toBeNull();
  });

  describe("the new presets are genuinely diversified and match their stated risk", () => {
    const fresh = PRESET_PORTFOLIOS;
    const classShare = (preset: (typeof fresh)[number], classes: string[]) =>
      preset.allocations.filter((a) => classes.includes(bySymbol.get(a.ticker)!.assetClass)).reduce((s, a) => s + a.weightPct, 0);

    it("each holds at least two funds, and none puts more than 60% in a single fund", () => {
      for (const p of fresh) {
        expect(p.allocations.length).toBeGreaterThanOrEqual(2);
        expect(Math.max(...p.allocations.map((a) => a.weightPct))).toBeLessThanOrEqual(60);
      }
    });

    it("LOW risk presets are mostly bonds and cash-like holdings", () => {
      for (const p of fresh.filter((x) => x.riskLevel === "LOW")) expect(classShare(p, ["BOND"])).toBeGreaterThanOrEqual(60);
    });

    it("HIGH risk presets are mostly equities", () => {
      for (const p of fresh.filter((x) => x.riskLevel === "HIGH")) expect(classShare(p, ["EQUITY", "EQUITY_EM"])).toBeGreaterThanOrEqual(75);
    });

    it("there is at least one new preset at each risk level", () => {
      for (const risk of ["LOW", "MEDIUM", "HIGH"]) expect(fresh.some((p) => p.riskLevel === risk)).toBe(true);
    });
  });
});
