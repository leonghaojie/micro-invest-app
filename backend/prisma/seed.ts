/**
 * Seed script. Two independent concerns:
 *
 * 1. Portfolio templates — baseline data FR04/FR05 need to function at
 *    all (portfolio_templates has no other populate path in this repo).
 *    ⚠️ PLACEHOLDER figures — name/expectedReturn/volatility aren't
 *    sourced from the SRS/Design Model, which doesn't define a specific
 *    template lineup anywhere in this repo. Swap for the real product
 *    decision before demo/grading if one exists.
 *
 * 2. Synthetic peer data (SRS §2.6 / v1.2, resolves TBD-03) — locked
 *    strategy: ~30 synthetic peers per FULL-tier group (riskLevel ×
 *    budgetBand × goalType), flagged via User.isSynthetic, so
 *    MIN_GROUP_SIZE = 10 is reliably reachable across all three fallback
 *    tiers during Lab #4 testing and the final demo. Not yet
 *    implemented — lands alongside the Peer Benchmarking Engine
 *    (roadmap.md Phase 5).
 */
import { PrismaClient, RiskLevel } from "@prisma/client";

const prisma = new PrismaClient();

const SYNTHETIC_PEERS_PER_FULL_GROUP = 30;

const PORTFOLIO_TEMPLATES: { name: string; riskLevel: RiskLevel; expectedReturn: string; volatility: string }[] = [
  { name: "Conservative", riskLevel: RiskLevel.LOW, expectedReturn: "0.0400", volatility: "0.0500" },
  { name: "Balanced", riskLevel: RiskLevel.MEDIUM, expectedReturn: "0.0700", volatility: "0.1200" },
  { name: "Growth", riskLevel: RiskLevel.HIGH, expectedReturn: "0.1000", volatility: "0.2000" },
];

async function seedPortfolioTemplates(): Promise<void> {
  let created = 0;
  for (const template of PORTFOLIO_TEMPLATES) {
    // No unique constraint on `name` in the schema — find-or-create keeps
    // this idempotent across repeated `npm run prisma:seed` runs.
    const existing = await prisma.portfolioTemplate.findFirst({ where: { name: template.name } });
    if (!existing) {
      await prisma.portfolioTemplate.create({ data: template });
      created += 1;
    }
  }
  console.log(`[seed] portfolio templates: ${created} created, ${PORTFOLIO_TEMPLATES.length - created} already present.`);
}

async function main() {
  await seedPortfolioTemplates();

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
