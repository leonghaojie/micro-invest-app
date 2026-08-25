/**
 * Live ingestion tool, step 2 of 2 — reads the raw JSON written by
 * `ingest-funds-yfinance.py` (one file per ticker in ./yfinance-data/) and
 * upserts Fund + FundMonthlyReturn via Prisma. Mirrors the structure of the
 * old ingest-funds.ts (EODHD) — kept as a separate TS step, rather than a
 * DB write from Python, so the actual write stays Prisma-only.
 *
 * DECISIONS.md #1 third amendment (25 Aug 2026).
 *
 * Usage:
 *   python prisma/ingest-funds-yfinance.py   (writes prisma/yfinance-data/*.json)
 *   npx tsx prisma/ingest-funds-yfinance.ts  (or `npm run prisma:ingest-funds-yfinance`)
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

const DATA_DIR = join(__dirname, "yfinance-data");

interface RawRow {
  date: string; // YYYY-MM-DD, first-of-month
  close: number;
  dividends: number;
}

interface RawTicker {
  symbol: string;
  exchange: string;
  name: string;
  assetClass: string;
  currency: string;
  rows: RawRow[];
}

/** Drops the final row if it's the current (real-world) calendar month —
 * yfinance always includes an in-progress bar for the month still open,
 * whose close isn't final, so its return isn't a real closed-month return
 * yet. Everything else is a genuinely closed month. */
function dropIncompleteCurrentMonth(rows: RawRow[]): RawRow[] {
  if (rows.length === 0) return rows;
  const now = new Date();
  const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const last = rows[rows.length - 1];
  return last.date.startsWith(currentMonthKey) ? rows.slice(0, -1) : rows;
}

interface DerivedReturn {
  monthDate: Date;
  startPrice: number;
  endPrice: number;
  dividendAmount: number;
  returnPct: number;
}

function deriveMonthlyReturns(rows: RawRow[]): DerivedReturn[] {
  const complete = dropIncompleteCurrentMonth(rows);
  const out: DerivedReturn[] = [];
  for (let i = 1; i < complete.length; i++) {
    const prev = complete[i - 1];
    const cur = complete[i];
    const returnPct = (cur.close + cur.dividends - prev.close) / prev.close;
    out.push({
      monthDate: new Date(cur.date + "T00:00:00.000Z"),
      startPrice: prev.close,
      endPrice: cur.close,
      dividendAmount: cur.dividends,
      returnPct,
    });
  }
  return out;
}

async function main() {
  const manifestPath = join(DATA_DIR, "_manifest.json");
  let manifest: string[];
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    throw new Error(
      `Couldn't read ${manifestPath} — run \`python prisma/ingest-funds-yfinance.py\` first.`
    );
  }

  let fundsUpserted = 0;
  let returnsUpserted = 0;

  for (const symbol of manifest) {
    const raw: RawTicker = JSON.parse(readFileSync(join(DATA_DIR, `${symbol}.json`), "utf-8"));
    const derived = deriveMonthlyReturns(raw.rows);

    const fund = await prisma.fund.upsert({
      where: { ticker_exchange: { ticker: raw.symbol, exchange: raw.exchange } },
      create: {
        ticker: raw.symbol,
        exchange: raw.exchange,
        name: raw.name,
        assetClass: raw.assetClass,
        currency: raw.currency,
        dataSource: "YFINANCE",
      },
      update: { name: raw.name, assetClass: raw.assetClass, currency: raw.currency, dataSource: "YFINANCE" },
    });
    fundsUpserted += 1;

    for (const r of derived) {
      await prisma.fundMonthlyReturn.upsert({
        where: { fundId_monthDate: { fundId: fund.id, monthDate: r.monthDate } },
        create: {
          fundId: fund.id,
          monthDate: r.monthDate,
          startPrice: r.startPrice.toFixed(4),
          endPrice: r.endPrice.toFixed(4),
          dividendAmount: r.dividendAmount.toFixed(4),
          returnPct: r.returnPct.toFixed(6),
        },
        update: {
          startPrice: r.startPrice.toFixed(4),
          endPrice: r.endPrice.toFixed(4),
          dividendAmount: r.dividendAmount.toFixed(4),
          returnPct: r.returnPct.toFixed(6),
        },
      });
      returnsUpserted += 1;
    }

    console.log(`[ingest] ${raw.symbol}.${raw.exchange}: ${derived.length} monthly returns upserted.`);
  }

  console.log(`[ingest] done: ${fundsUpserted} funds, ${returnsUpserted} monthly returns upserted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
