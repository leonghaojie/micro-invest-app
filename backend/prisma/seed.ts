/**
 * Seed script. Stays offline-safe — no network calls, no API key required
 * — so `npm run prisma:seed` works out of the box for anyone cloning the
 * repo. For a wider, live-sourced fund catalog, see prisma/ingest-funds.ts
 * (needs an EODHD_API_KEY in backend/.env).
 *
 * Three independent concerns:
 *
 * 1. Funds + historical returns (DECISIONS.md #1, both amendments) —
 *    real, dated annual total returns for seven real funds, spanning
 *    several asset classes so the multi-fund portfolio builder has
 *    something meaningful to combine:
 *      A35 — ABF Singapore Bond Index Fund ETF (SGX, bonds)
 *      CFA — Amova/NikkoAM-StraitsTrading Asia ex Japan REIT ETF (SGX, REITs)
 *      ES3 — SPDR Straits Times Index ETF (SGX, SG equity)
 *      SPY — SPDR S&P 500 ETF Trust (US, US equity)
 *      AGG — iShares Core U.S. Aggregate Bond ETF (US, US bonds)
 *      VWO — Vanguard FTSE Emerging Markets ETF (US, EM equity)
 *      GLD — SPDR Gold Shares (US, gold/commodity)
 *    A35/CFA/ES3 are all on POSB Invest-Saver's counter list (continuity
 *    with this project's Singapore micro-investing market research).
 *    Every fund here is web-search sourced (dataSource="WEB_SEARCH") —
 *    the EODHD API (see prisma/ingest-funds.ts) turned out not to be
 *    usable for this catalog: its plan doesn't cover SGX at all, and
 *    separately caps historical depth at 1 year on every exchange it
 *    does cover, confirmed directly against the live API response
 *    ("Data is limited by one year as you have free subscription").
 *    Sourced via web search against each fund's Yahoo Finance/financial-
 *    data performance-history pages in Aug 2026 (search-engine-
 *    summarized, not a downloaded raw CSV — treat as real-and-citable
 *    but not audit-grade precision; re-verify against the source pages
 *    directly before using this for anything beyond FYP demo purposes).
 *    Series length varies by fund with real reasons, not padded to
 *    match: CFA only has 8 years (2018-2025, its real fund launched
 *    March 2017), VWO has 9 (2016-2024, 2025 not found), GLD only has 4
 *    (2022-2025, earlier years not found via search this pass) — see
 *    DECISIONS.md #1 for the full citation trail.
 *
 * 2. Preset portfolios (DECISIONS.md #1 second amendment) — one
 *    single-fund, 100%-weight Portfolio per fund above, replacing what
 *    used to be the fixed Conservative/Balanced/Growth PortfolioTemplate
 *    rows. Still there as quick-start options; users can now also build
 *    their own multi-fund Portfolio (portfolio.service.ts) instead.
 *
 * 3. Synthetic peer data (SRS §2.6 / v1.2, resolves TBD-03) — locked
 *    strategy: ~30 synthetic peers per FULL-tier group (riskLevel ×
 *    budgetBand × goalType), flagged via User.isSynthetic, so
 *    MIN_GROUP_SIZE = 10 is reliably reachable across all three fallback
 *    tiers during Lab #4 testing and the final demo. The Peer Benchmarking
 *    Engine itself (FR09–11) is implemented and works fine against real
 *    users — this script is the one still-open piece (`FYP Roadmap.docx`
 *    Phase 5, DECISIONS.md Open Items) that would populate groups ahead
 *    of real user growth.
 */
import { PrismaClient, RiskLevel } from "@prisma/client";

const prisma = new PrismaClient();

const SYNTHETIC_PEERS_PER_FULL_GROUP = 30;

interface FundSeed {
  ticker: string;
  exchange: string;
  name: string;
  assetClass: string;
  currency: string;
  returns: { year: number; returnRate: string }[];
}

const FUNDS: FundSeed[] = [
  {
    ticker: "A35",
    exchange: "SGX",
    name: "ABF Singapore Bond Index Fund ETF",
    assetClass: "BOND",
    currency: "SGD",
    returns: [
      { year: 2016, returnRate: "0.0232" },
      { year: 2017, returnRate: "0.0347" },
      { year: 2018, returnRate: "0.0192" },
      { year: 2019, returnRate: "0.0457" },
      { year: 2020, returnRate: "0.0803" },
      { year: 2021, returnRate: "-0.0549" },
      { year: 2022, returnRate: "-0.0718" },
      { year: 2023, returnRate: "0.0446" },
      { year: 2024, returnRate: "0.0296" },
      { year: 2025, returnRate: "0.0758" },
    ],
  },
  {
    ticker: "CFA",
    exchange: "SGX",
    name: "Amova/NikkoAM-StraitsTrading Asia ex Japan REIT ETF",
    assetClass: "REIT",
    currency: "SGD",
    // Real fund launched March 2017 — no full year of data for 2016/2017.
    returns: [
      { year: 2018, returnRate: "-0.0140" },
      { year: 2019, returnRate: "0.1802" },
      { year: 2020, returnRate: "-0.0447" },
      { year: 2021, returnRate: "0.0115" },
      { year: 2022, returnRate: "-0.1272" },
      { year: 2023, returnRate: "0.0026" },
      { year: 2024, returnRate: "-0.0607" },
      { year: 2025, returnRate: "0.1462" },
    ],
  },
  {
    ticker: "ES3",
    exchange: "SGX",
    name: "SPDR Straits Times Index ETF",
    assetClass: "EQUITY",
    currency: "SGD",
    returns: [
      { year: 2016, returnRate: "0.0308" },
      { year: 2017, returnRate: "0.2111" },
      { year: 2018, returnRate: "-0.0663" },
      { year: 2019, returnRate: "0.0908" },
      { year: 2020, returnRate: "-0.0751" },
      { year: 2021, returnRate: "0.1249" },
      { year: 2022, returnRate: "0.0759" },
      { year: 2023, returnRate: "0.0402" },
      { year: 2024, returnRate: "0.2211" },
      { year: 2025, returnRate: "0.2814" },
    ],
  },
  {
    ticker: "SPY",
    exchange: "US",
    name: "SPDR S&P 500 ETF Trust",
    assetClass: "EQUITY",
    currency: "USD",
    returns: [
      { year: 2016, returnRate: "0.1200" },
      { year: 2017, returnRate: "0.2170" },
      { year: 2018, returnRate: "-0.0456" },
      { year: 2019, returnRate: "0.3122" },
      { year: 2020, returnRate: "0.1837" },
      { year: 2021, returnRate: "0.2875" },
      { year: 2022, returnRate: "-0.1817" },
      { year: 2023, returnRate: "0.2619" },
      { year: 2024, returnRate: "0.2489" },
      { year: 2025, returnRate: "0.1772" },
    ],
  },
  {
    ticker: "AGG",
    exchange: "US",
    name: "iShares Core U.S. Aggregate Bond ETF",
    assetClass: "BOND",
    currency: "USD",
    returns: [
      { year: 2016, returnRate: "0.0260" },
      { year: 2017, returnRate: "0.0355" },
      { year: 2018, returnRate: "0.0010" },
      { year: 2019, returnRate: "0.0845" },
      { year: 2020, returnRate: "0.0748" },
      { year: 2021, returnRate: "-0.0177" },
      { year: 2022, returnRate: "-0.1302" },
      { year: 2023, returnRate: "0.0566" },
      { year: 2024, returnRate: "0.0131" },
      { year: 2025, returnRate: "0.0719" },
    ],
  },
  {
    ticker: "VWO",
    exchange: "US",
    name: "Vanguard FTSE Emerging Markets ETF",
    assetClass: "EQUITY_EM",
    currency: "USD",
    // 2025 not found via search this pass — 9 real years, not padded to 10.
    returns: [
      { year: 2016, returnRate: "0.1221" },
      { year: 2017, returnRate: "0.3148" },
      { year: 2018, returnRate: "-0.1477" },
      { year: 2019, returnRate: "0.2076" },
      { year: 2020, returnRate: "0.1519" },
      { year: 2021, returnRate: "0.0130" },
      { year: 2022, returnRate: "-0.1799" },
      { year: 2023, returnRate: "0.0927" },
      { year: 2024, returnRate: "0.1058" },
    ],
  },
  {
    ticker: "GLD",
    exchange: "US",
    name: "SPDR Gold Shares",
    assetClass: "COMMODITY",
    currency: "USD",
    // 2016-2021 not found via search this pass — 4 real years, not padded.
    returns: [
      { year: 2022, returnRate: "-0.0077" },
      { year: 2023, returnRate: "0.1269" },
      { year: 2024, returnRate: "0.2666" },
      { year: 2025, returnRate: "0.6368" },
    ],
  },
];

const PRESET_PORTFOLIOS: { name: string; riskLevel: RiskLevel; ticker: string }[] = [
  { name: "Conservative", riskLevel: RiskLevel.LOW, ticker: "A35" },
  { name: "Balanced", riskLevel: RiskLevel.MEDIUM, ticker: "CFA" },
  { name: "Growth", riskLevel: RiskLevel.HIGH, ticker: "ES3" },
];

async function seedFunds(): Promise<Record<string, string>> {
  const fundIdByTicker: Record<string, string> = {};
  let fundsCreated = 0;
  let returnsUpserted = 0;

  for (const spec of FUNDS) {
    // Upsert (not find-or-create): a Fund row for this ticker/exchange may
    // already exist from a different pipeline (e.g. a partial
    // ingest-funds.ts run that created the row before discovering it had
    // no usable historical depth) — always converge name/assetClass/
    // currency/dataSource to what this script defines, rather than
    // silently keeping stale metadata from whichever source got there
    // first.
    const existing = await prisma.fund.findUnique({ where: { ticker_exchange: { ticker: spec.ticker, exchange: spec.exchange } } });
    const fund = await prisma.fund.upsert({
      where: { ticker_exchange: { ticker: spec.ticker, exchange: spec.exchange } },
      create: {
        ticker: spec.ticker,
        exchange: spec.exchange,
        name: spec.name,
        assetClass: spec.assetClass,
        currency: spec.currency,
        dataSource: "WEB_SEARCH",
      },
      update: { name: spec.name, assetClass: spec.assetClass, currency: spec.currency, dataSource: "WEB_SEARCH" },
    });
    if (!existing) fundsCreated += 1;
    fundIdByTicker[spec.ticker] = fund.id;

    for (const { year, returnRate } of spec.returns) {
      await prisma.historicalReturn.upsert({
        where: { fundId_year: { fundId: fund.id, year } },
        create: { fundId: fund.id, year, returnRate },
        update: { returnRate },
      });
      returnsUpserted += 1;
    }
  }

  console.log(`[seed] funds: ${fundsCreated} created, ${FUNDS.length - fundsCreated} already present; ${returnsUpserted} historical returns upserted.`);
  return fundIdByTicker;
}

async function seedPresetPortfolios(fundIdByTicker: Record<string, string>): Promise<void> {
  let created = 0;
  for (const preset of PRESET_PORTFOLIOS) {
    const existing = await prisma.portfolio.findFirst({ where: { name: preset.name, isPreset: true } });
    if (existing) continue;

    await prisma.portfolio.create({
      data: {
        name: preset.name,
        riskLevel: preset.riskLevel,
        isPreset: true,
        userId: null,
        allocations: {
          create: [{ fundId: fundIdByTicker[preset.ticker], weightPct: "100.00" }],
        },
      },
    });
    created += 1;
  }
  console.log(`[seed] preset portfolios: ${created} created, ${PRESET_PORTFOLIOS.length - created} already present.`);
}

async function main() {
  const fundIdByTicker = await seedFunds();
  await seedPresetPortfolios(fundIdByTicker);

  console.log(
    `[seed] TODO Phase 5: generate ${SYNTHETIC_PEERS_PER_FULL_GROUP} isSynthetic=true users ` +
      "per (riskLevel x budgetBand x goalType) combination, plus simulation history for each. " +
      "See SRS §2.6 and Design Model §7."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
