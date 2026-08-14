/**
 * Synthetic peer data seed script (SRS §2.6 / v1.2, resolves TBD-03).
 *
 * Locked strategy: ~30 synthetic peers per FULL-tier group
 * (riskLevel × budgetBand × goalType), flagged via User.isSynthetic, so
 * MIN_GROUP_SIZE = 10 is reliably reachable across all three fallback
 * tiers during Lab #4 testing and the final demo.
 *
 * Not yet implemented — this is the Phase 2 skeleton. Actual generation
 * logic (portfolio templates + synthetic simulations per peer) lands
 * alongside the Peer Benchmarking Engine (roadmap.md Phase 5).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SYNTHETIC_PEERS_PER_FULL_GROUP = 30;

async function main() {
  console.log(
    `[seed] TODO Phase 5: generate ${SYNTHETIC_PEERS_PER_FULL_GROUP} isSynthetic=true users ` +
      "per (riskLevel x budgetBand x goalType) combination, plus portfolio templates " +
      "and simulation history for each. See SRS §2.6 and Design Model §7."
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
