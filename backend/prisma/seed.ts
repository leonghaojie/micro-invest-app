/**
 * Seed script. Three independent concerns:
 *
 * 1. Portfolio templates — baseline data FR04/FR05 need to function at
 *    all (portfolio_templates has no other populate path in this repo).
 *    ⚠️ name/riskLevel/volatility are still a PLACEHOLDER lineup — the
 *    SRS/Design Model doesn't define a specific template lineup anywhere
 *    in this repo. expectedReturn is likewise a placeholder now that it's
 *    only a display fallback (see #2) — swap all of these for the real
 *    product decision before demo/grading if one exists.
 *
 * 2. Historical returns (DECISIONS.md #1 amendment) — real, dated annual
 *    total returns for the actual SGX-listed fund each template is
 *    anchored to, all three on POSB Invest-Saver's counter list:
 *      Conservative -> A35 (ABF Singapore Bond Index Fund ETF)
 *      Balanced     -> CFA (Amova/NikkoAM-StraitsTrading Asia ex Japan REIT ETF)
 *      Growth       -> ES3 (SPDR Straits Times Index ETF)
 *    Sourced via web search against each fund's Yahoo Finance performance-
 *    history page in Aug 2026 (search-engine-summarized, not a downloaded
 *    raw CSV — treat as real-and-citable but not audit-grade precision;
 *    re-verify against the source pages directly before using this for
 *    anything beyond FYP demo purposes). CFA only has 8 years (2018-2025)
 *    since its real fund launched March 2017 — its series is intentionally
 *    shorter than A35/ES3's 10 years (2016-2025), not padded to match.
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

const PORTFOLIO_TEMPLATES: { name: string; riskLevel: RiskLevel; expectedReturn: string; volatility: string }[] = [
  { name: "Conservative", riskLevel: RiskLevel.LOW, expectedReturn: "0.0400", volatility: "0.0500" },
  { name: "Balanced", riskLevel: RiskLevel.MEDIUM, expectedReturn: "0.0700", volatility: "0.1200" },
  { name: "Growth", riskLevel: RiskLevel.HIGH, expectedReturn: "0.1000", volatility: "0.2000" },
];

// Real annual total returns, ascending by year. Source: each fund's Yahoo
// Finance performance-history page (finance.yahoo.com/quote/<TICKER>.SI
// /performance/), retrieved Aug 2026.
const HISTORICAL_RETURNS: Record<string, { year: number; returnRate: string }[]> = {
  // A35 — ABF Singapore Bond Index Fund ETF
  Conservative: [
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
  // CFA — Amova/NikkoAM-StraitsTrading Asia ex Japan REIT ETF (fund
  // launched March 2017 — no full year of data for 2016/2017).
  Balanced: [
    { year: 2018, returnRate: "-0.0140" },
    { year: 2019, returnRate: "0.1802" },
    { year: 2020, returnRate: "-0.0447" },
    { year: 2021, returnRate: "0.0115" },
    { year: 2022, returnRate: "-0.1272" },
    { year: 2023, returnRate: "0.0026" },
    { year: 2024, returnRate: "-0.0607" },
    { year: 2025, returnRate: "0.1462" },
  ],
  // ES3 — SPDR Straits Times Index ETF
  Growth: [
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
};

async function seedPortfolioTemplates(): Promise<Record<string, string>> {
  let created = 0;
  const idsByName: Record<string, string> = {};
  for (const template of PORTFOLIO_TEMPLATES) {
    // No unique constraint on `name` in the schema — find-or-create keeps
    // this idempotent across repeated `npm run prisma:seed` runs.
    const existing = await prisma.portfolioTemplate.findFirst({ where: { name: template.name } });
    if (existing) {
      idsByName[template.name] = existing.id;
    } else {
      const row = await prisma.portfolioTemplate.create({ data: template });
      idsByName[template.name] = row.id;
      created += 1;
    }
  }
  console.log(`[seed] portfolio templates: ${created} created, ${PORTFOLIO_TEMPLATES.length - created} already present.`);
  return idsByName;
}

async function seedHistoricalReturns(templateIdsByName: Record<string, string>): Promise<void> {
  let total = 0;
  for (const [templateName, years] of Object.entries(HISTORICAL_RETURNS)) {
    const templateId = templateIdsByName[templateName];
    for (const { year, returnRate } of years) {
      // @@unique([templateId, year]) makes this idempotent via upsert.
      await prisma.historicalReturn.upsert({
        where: { templateId_year: { templateId, year } },
        create: { templateId, year, returnRate },
        update: { returnRate },
      });
      total += 1;
    }
  }
  console.log(`[seed] historical returns: ${total} rows upserted across ${Object.keys(HISTORICAL_RETURNS).length} templates.`);
}

async function main() {
  const templateIds = await seedPortfolioTemplates();
  await seedHistoricalReturns(templateIds);

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
