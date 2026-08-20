/**
 * Live ingestion tool — pulls real historical EOD prices from the EODHD
 * API (eodhd.com) and derives annual total returns for one or more funds,
 * upserting Fund + HistoricalReturn rows (DECISIONS.md #1 amendments).
 *
 * Not run automatically by `npm run prisma:seed` — that script stays
 * offline-safe (no network call, no API key required) using a small
 * baked-in starter catalog. This script is the live tool for expanding
 * that catalog or refreshing figures, given a real EODHD_API_KEY.
 *
 * ⚠️ This key's plan does not cover Singapore Exchange (confirmed by
 * querying /api/exchanges-list/ directly — SGX is absent from the 70
 * exchanges returned). SGX-listed funds (A35/CFA/ES3) stay sourced via
 * web search in seed.ts; this script is only for EODHD-covered exchanges.
 *
 * Usage: EODHD_API_KEY=... npx tsx prisma/ingest-funds.ts
 * (or `npm run prisma:ingest-funds`, which reads backend/.env)
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

interface FundSpec {
  ticker: string;
  exchange: string; // EODHD exchange code, e.g. "US"
  name: string;
  assetClass: string;
  currency: string;
  fromYear: number;
}

// Diversified starter catalog beyond the 3 SGX funds — spans equity,
// bonds, REITs, emerging markets, and a commodity, so the multi-fund
// portfolio builder has something meaningful to combine.
const EODHD_FUNDS: FundSpec[] = [
  { ticker: "SPY", exchange: "US", name: "SPDR S&P 500 ETF Trust", assetClass: "EQUITY", currency: "USD", fromYear: 2016 },
  { ticker: "AGG", exchange: "US", name: "iShares Core U.S. Aggregate Bond ETF", assetClass: "BOND", currency: "USD", fromYear: 2016 },
  { ticker: "VNQ", exchange: "US", name: "Vanguard Real Estate ETF", assetClass: "REIT", currency: "USD", fromYear: 2016 },
  { ticker: "VWO", exchange: "US", name: "Vanguard FTSE Emerging Markets ETF", assetClass: "EQUITY_EM", currency: "USD", fromYear: 2016 },
  { ticker: "GLD", exchange: "US", name: "SPDR Gold Shares", assetClass: "COMMODITY", currency: "USD", fromYear: 2016 },
];

interface EodRow {
  date: string; // YYYY-MM-DD
  adjusted_close: number;
}

async function fetchMonthlyCloses(spec: FundSpec, apiKey: string): Promise<EodRow[]> {
  const url = `https://eodhd.com/api/eod/${spec.ticker}.${spec.exchange}?api_token=${apiKey}&fmt=json&period=m&from=${spec.fromYear}-01-01`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`EODHD request failed for ${spec.ticker}.${spec.exchange}: HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!Array.isArray(body)) {
    throw new Error(`EODHD returned an unexpected shape for ${spec.ticker}.${spec.exchange}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body as EodRow[];
}

/** Derives one annual total return per full calendar year from monthly
 * adjusted closes: (last close of year Y) / (last close of year Y-1) - 1.
 * Uses adjusted_close so dividends/splits are reflected (total return,
 * matching how the SGX figures were sourced). Drops the first year in the
 * series since it has no prior-year close to compare against, and drops
 * a final partial year (fewer than ~11 months of data) so we don't derive
 * a return from an incomplete year. */
function deriveAnnualReturns(rows: EodRow[]): { year: number; returnRate: number }[] {
  const byYear = new Map<number, EodRow[]>();
  for (const row of rows) {
    const year = Number(row.date.slice(0, 4));
    const list = byYear.get(year) ?? [];
    list.push(row);
    byYear.set(year, list);
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const lastCloseByYear = new Map<number, number>();
  for (const year of years) {
    const monthsInYear = byYear.get(year)!;
    if (year === years[years.length - 1] && monthsInYear.length < 11) continue; // incomplete final year
    const last = monthsInYear[monthsInYear.length - 1];
    lastCloseByYear.set(year, last.adjusted_close);
  }

  const completeYears = [...lastCloseByYear.keys()].sort((a, b) => a - b);
  const returns: { year: number; returnRate: number }[] = [];
  for (let i = 1; i < completeYears.length; i++) {
    const year = completeYears[i];
    const prevClose = lastCloseByYear.get(completeYears[i - 1])!;
    const close = lastCloseByYear.get(year)!;
    returns.push({ year, returnRate: close / prevClose - 1 });
  }
  return returns;
}

async function main() {
  const apiKey = process.env.EODHD_API_KEY;
  if (!apiKey || apiKey === "replace-me") {
    throw new Error("EODHD_API_KEY is not set in backend/.env — see .env.example.");
  }

  for (const spec of EODHD_FUNDS) {
    console.log(`[ingest] fetching ${spec.ticker}.${spec.exchange}...`);
    const rows = await fetchMonthlyCloses(spec, apiKey);
    const annualReturns = deriveAnnualReturns(rows);

    const fund = await prisma.fund.upsert({
      where: { ticker_exchange: { ticker: spec.ticker, exchange: spec.exchange } },
      create: {
        ticker: spec.ticker,
        exchange: spec.exchange,
        name: spec.name,
        assetClass: spec.assetClass,
        currency: spec.currency,
        dataSource: "EODHD",
      },
      update: { name: spec.name, assetClass: spec.assetClass, currency: spec.currency, dataSource: "EODHD" },
    });

    for (const { year, returnRate } of annualReturns) {
      await prisma.historicalReturn.upsert({
        where: { fundId_year: { fundId: fund.id, year } },
        create: { fundId: fund.id, year, returnRate: returnRate.toFixed(4) },
        update: { returnRate: returnRate.toFixed(4) },
      });
    }
    console.log(`[ingest] ${spec.ticker}.${spec.exchange}: ${annualReturns.length} annual returns upserted.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
