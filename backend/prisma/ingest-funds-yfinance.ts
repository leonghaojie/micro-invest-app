/**
 * Live ingestion tool, step 2 of 2 - reads the raw JSON written by
 * `ingest-funds-yfinance.py` (one file per ticker in ./yfinance-data/) and
 * loads it into Fund + FundMonthlyReturn via Prisma.
 *
 * DECISIONS.md #1 third amendment (25 Aug 2026); the loading itself now lives in
 * src/services/fundDataUpdate.service.ts so this manual path and the automatic
 * monthly update (DECISIONS.md #15) share one implementation. For the usual case
 * - "bring the data up to date" - prefer `npm run update-fund-data`, which does
 * both steps and recomputes plans.
 *
 * Usage:
 *   python prisma/ingest-funds-yfinance.py   (writes prisma/yfinance-data/*.json)
 *   npx tsx prisma/ingest-funds-yfinance.ts  (or `npm run prisma:ingest-funds-yfinance`)
 */
import { prisma } from "../src/config/prisma";
import { DATA_DIR, loadFundDataFromDir } from "../src/services/fundDataUpdate.service";

async function main() {
  try {
    const result = await loadFundDataFromDir(DATA_DIR);
    console.log(`[ingest] done: ${result.funds} funds, ${result.newMonths} new months, ${result.revisedMonths} revised, ${result.rejected} rejected.`);
  } catch (err) {
    throw new Error(`Couldn't load the fetched data (${err instanceof Error ? err.message : String(err)}) - run \`python prisma/ingest-funds-yfinance.py\` first.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
