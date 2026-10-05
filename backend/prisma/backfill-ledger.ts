/**
 * Moves every old fixed plan into the ledger (DECISIONS.md #19). Idempotent: run it after
 * applying the `ledger` migration to a database that already has plans; plans already moved
 * are skipped.
 *
 *   npm run backfill-ledger
 */
import { prisma } from "../src/config/prisma";
import { backfillLegacyPlans } from "../src/services/ledgerBackfill.service";

backfillLegacyPlans()
  .then((r) => console.log(`[ledger] backfill: ${r.migrated} plans migrated, ${r.skipped} skipped.`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
