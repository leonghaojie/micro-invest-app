/**
 * Brings the fund history up to date by hand - the same job the server runs
 * automatically (DECISIONS.md #15): fetch fresh monthly data, load it, and
 * recompute every plan.
 *
 * Usage:
 *   npm run update-fund-data              only if a completed month is missing
 *   npm run update-fund-data -- --force   fetch and load regardless
 */
import { prisma } from "../src/config/prisma";
import { fetchWithPython } from "../src/jobs/pythonFetcher";
import { runFundDataUpdate } from "../src/services/fundDataUpdate.service";

async function main() {
  const force = process.argv.includes("--force");
  const summary = await runFundDataUpdate({ fetchRaw: () => fetchWithPython(), force });

  console.log(`[update-fund-data] ${summary.status}: data ${summary.latestBefore ?? "none"} -> ${summary.latestAfter ?? "none"} (latest complete month ${summary.expectedMonth}).`);
  if (summary.load) {
    console.log(`[update-fund-data] ${summary.load.newMonths} new months, ${summary.load.revisedMonths} revised, ${summary.load.rejected} rejected, ${summary.plansRefreshed} plans refreshed.`);
    if (summary.load.gaps.length > 0) console.error("[update-fund-data] WARNING: gaps found:", JSON.stringify(summary.load.gaps));
  }
  if (summary.error) console.error(`[update-fund-data] ${summary.error}`);
  process.exitCode = summary.status === "failed" ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
