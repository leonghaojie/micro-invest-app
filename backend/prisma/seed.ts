/**
 * Seed script. Requires `npm run prisma:ingest-funds` to have been run at
 * least once first (fetches real Fund + FundMonthlyReturn rows via
 * yfinance — DECISIONS.md #1 third amendment) — this script no longer
 * carries a hand-typed fallback catalog the way the old annual-return
 * version did, since a monthly series is too large to hand-maintain and
 * the whole point of this pipeline is real, not approximated, data.
 *
 * Two concerns:
 *
 * 1. Preset portfolios — the quick-start portfolios in
 *    src/utils/presetPortfolios.ts: the original single-fund
 *    Conservative/Balanced/Growth plus diversified multi-fund ones
 *    (DECISIONS.md #1 second amendment, #16). Existing presets are never
 *    modified. Users can still build their own multi-fund Portfolio
 *    (portfolio.service.ts).
 *
 * 2. Synthetic peer data (SRS §2.6, DECISIONS.md #4, #9) — ~300 reproducible
 *    peers from src/utils/syntheticPeers.ts, each with a profile, a custom
 *    multi-fund portfolio and a Plan, so the peer dashboard's segmentation,
 *    distribution, trajectory and allocation views have a population large
 *    enough to mean something. Income is anchored to published SingStat
 *    figures; expense ratio, contribution rate and portfolio mix are labelled
 *    assumptions (see syntheticPeers.ts).
 *
 *    Usage:
 *      npm run prisma:seed                           create peers if none exist,
 *                                                    otherwise refresh their plans
 *      npm run prisma:seed -- --reset-synthetic      delete ALL synthetic users
 *                                                    (cascading their profiles,
 *                                                    portfolios, plans and any
 *                                                    friend links to them) and
 *                                                    regenerate
 *      npm run prisma:seed -- --reset-synthetic --peers=500
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient, RiskLevel } from "@prisma/client";
import { backfillLegacyPlans } from "../src/services/ledgerBackfill.service";
import { buysInMonth } from "../src/utils/syntheticPeers";
import { planService } from "../src/services/plan.service";
import { PRESET_PORTFOLIOS } from "../src/utils/presetPortfolios";
import { assignExperience, experienceStream, FundInfo, generatePeerSpecs, SyntheticPeerSpec } from "../src/utils/syntheticPeers";

const prisma = new PrismaClient();

const DEFAULT_PEER_COUNT = 300;
// Fixed seed => the same population every time the seed is (re)generated.
const POPULATION_SEED = 20261003;
const CONCURRENCY = 8;

function parseArgs(): { resetSynthetic: boolean; peerCount: number } {
  const argv = process.argv.slice(2);
  const peers = argv.find((a) => a.startsWith("--peers="))?.split("=")[1];
  const peerCount = peers ? Number(peers) : DEFAULT_PEER_COUNT;
  if (!Number.isInteger(peerCount) || peerCount < 1) {
    throw new Error(`--peers must be a positive integer (got "${peers}")`);
  }
  return { resetSynthetic: argv.includes("--reset-synthetic"), peerCount };
}

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// The preset definitions live in src/utils/presetPortfolios.ts (tested there); the fund
// catalog, which says which exchange each ticker is on, is prisma/fund-catalog.json.
const CATALOG: { symbol: string; exchange: string }[] = JSON.parse(readFileSync(join(__dirname, "fund-catalog.json"), "utf-8"));
const EXCHANGE_OF = new Map(CATALOG.map((c) => [c.symbol, c.exchange]));

/** Creates any preset portfolio that does not exist yet. Presets are matched by NAME and an
 * existing one is never touched: plans point at their portfolio and are recomputed on read,
 * so editing a preset's funds would silently rewrite those plans' results. */
async function seedPresetPortfolios(): Promise<void> {
  let created = 0;
  for (const preset of PRESET_PORTFOLIOS) {
    const existing = await prisma.portfolio.findFirst({ where: { name: preset.name, isPreset: true } });
    if (existing) continue;

    const funds = await Promise.all(
      preset.allocations.map(async (a) => ({
        allocation: a,
        fund: await prisma.fund.findUnique({
          where: { ticker_exchange: { ticker: a.ticker, exchange: EXCHANGE_OF.get(a.ticker) ?? "US" } },
        }),
      }))
    );
    const missing = funds.filter((f) => !f.fund).map((f) => f.allocation.ticker);
    if (missing.length > 0) {
      console.warn(
        `[seed] skipping preset "${preset.name}" - fund(s) not found: ${missing.join(", ")}. ` +
          "Run `npm run update-fund-data -- --force` first."
      );
      continue;
    }

    await prisma.portfolio.create({
      data: {
        name: preset.name,
        riskLevel: RiskLevel[preset.riskLevel],
        isPreset: true,
        userId: null,
        allocations: {
          create: funds.map(({ allocation, fund }) => ({ fundId: fund!.id, weightPct: allocation.weightPct.toFixed(2) })),
        },
      },
    });
    created += 1;
  }
  console.log(`[seed] preset portfolios: ${created} created, ${PRESET_PORTFOLIOS.length - created} already present/skipped.`);
}

/** The latest month every fund has data for — a plan can't run past the
 * least-up-to-date fund, so synthetic start months are counted back from it. */
async function latestCommonDataMonth(): Promise<Date | null> {
  const perFund = await prisma.fundMonthlyReturn.groupBy({ by: ["fundId"], _max: { monthDate: true } });
  const months = perFund.map((f) => f._max.monthDate).filter((d): d is Date => d !== null);
  if (months.length === 0) return null;
  return months.reduce((min, d) => (d < min ? d : min));
}

/** Creates one synthetic peer in the old fixed-plan form; returns the new user's id, or null on failure. */
async function createSyntheticPeer(spec: SyntheticPeerSpec, anchorMonth: Date): Promise<string | null> {
  const email = `synthetic+${spec.index}@seed.local`;
  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: "synthetic-not-a-real-login",
        isSynthetic: true,
        profile: {
          create: {
            riskLevel: spec.riskLevel,
            goalType: spec.goalType,
            monthlyIncome: spec.income,
            monthlyExpense: spec.expense,
            age: spec.age,
            experienceLevel: spec.experienceLevel,
          },
        },
      },
    });

    const portfolio = await prisma.portfolio.create({
      data: {
        userId: user.id,
        name: "Custom mix",
        isPreset: false,
        riskLevel: spec.riskLevel,
        allocations: { create: spec.allocations.map((a) => ({ fundId: a.fundId, weightPct: a.weightPct })) },
      },
    });

    // monthsOfHistory months ending at the latest month all funds have.
    const startMonth = new Date(Date.UTC(anchorMonth.getUTCFullYear(), anchorMonth.getUTCMonth() - (spec.monthsOfHistory - 1), 1));
    // Written in the old fixed-plan form; backfillLegacyPlans turns it into ledger rows
    // (a recurring buy since its start month), the same path real accounts took.
    await prisma.plan.create({ data: { userId: user.id, portfolioId: portfolio.id, contributionAmount: spec.contribution, startMonth } });
    return user.id;
  } catch (err) {
    console.warn(`[seed] synthetic peer ${email}: failed (${(err as Error).message}).`);
    return null;
  }
}

/** Returns true if a fresh population was generated. */
async function seedSyntheticPeers({ resetSynthetic, peerCount }: { resetSynthetic: boolean; peerCount: number }): Promise<boolean> {
  const existing = await prisma.user.count({ where: { isSynthetic: true } });
  if (existing > 0 && !resetSynthetic) {
    console.log(`[seed] synthetic peers: ${existing} already present (use --reset-synthetic to regenerate).`);
    return false;
  }
  if (existing > 0) {
    // Cascades to profiles, custom portfolios, plans/months, sharing and any
    // friend links to these users.
    const { count } = await prisma.user.deleteMany({ where: { isSynthetic: true } });
    console.log(`[seed] reset: deleted ${count} existing synthetic users (and everything cascading from them).`);
  }

  const catalog: FundInfo[] = await prisma.fund.findMany({ select: { id: true, ticker: true, assetClass: true } });
  const anchorMonth = await latestCommonDataMonth();
  if (catalog.length === 0 || !anchorMonth) {
    console.warn("[seed] synthetic peers: no funds/return data found, skipping. Run `npm run prisma:ingest-funds` first.");
    return false;
  }

  const specs = generatePeerSpecs(peerCount, POPULATION_SEED, catalog);
  let created = 0;
  const specByUser = new Map<string, SyntheticPeerSpec>();
  await inChunks(specs, CONCURRENCY, async (spec) => {
    const userId = await createSyntheticPeer(spec, anchorMonth);
    if (userId) {
      created += 1;
      specByUser.set(userId, spec);
    }
    if (created % 50 === 0 && created > 0) console.log(`[seed]   ...${created}/${specs.length}`);
  });

  // Some peers invest irregularly (DECISIONS.md #19): they skip months, and, being manual buyers,
  // have no monthly buy going forward. Their later months are not simulated.
  const { migrated } = await backfillLegacyPlans({
    buys: (userId, month) => {
      const spec = specByUser.get(userId);
      return spec ? buysInMonth(POPULATION_SEED, spec.index, spec.buyRate, month) : true;
    },
    recurring: (userId) => (specByUser.get(userId)?.buyRate ?? 1) >= 1,
  });
  console.log(`[seed] synthetic peers: ${created}/${specs.length} created (seed ${POPULATION_SEED}, history ends ${anchorMonth.toISOString().slice(0, 7)}); ${migrated} turned into ledger accounts.`);
  return true;
}

/** Re-runs plan.service's recompute-on-read for every synthetic plan, so a
 * re-seed keeps their stored months in step with the latest fund data. */
async function refreshSyntheticPlans(): Promise<void> {
  const users = await prisma.user.findMany({ where: { isSynthetic: true, plan: { isNot: null } }, select: { id: true } });
  let refreshed = 0;
  await inChunks(users, CONCURRENCY, async (u) => {
    if (await planService.getActivePlan(u.id).catch(() => null)) refreshed += 1;
  });
  console.log(`[seed] refreshed ${refreshed}/${users.length} synthetic plans.`);
}

const DEMO_FRIEND_NAMES = [
  "Alex T.", "Priya N.", "Marcus L.", "Sarah K.", "Wei Ming", "Aisha R.", "Daniel C.", "Mei Ling",
  "Raj P.", "Chloe W.", "Hafiz M.", "Jia Hui", "Kevin O.", "Nur A.", "Brandon S.", "Yi Xuan",
  "Arjun D.", "Grace H.", "Farhan Z.", "Li Na", "Tom B.", "Siti R.",
];

/**
 * DECISIONS.md #8 (friends comparison): gives each synthetic user a display
 * name, a deterministic invite code (DEMO0001, DEMO0002, ...) and all
 * sharing switched on, so a single real account can demo the feature —
 * sending a request to one of these codes is auto-accepted
 * (friends.service.ts), since synthetic users can't log in to accept.
 * Idempotent, and runs even when the synthetic users already existed from
 * an earlier seed. The "DEMO" + digits form contains 0 and 1, which the
 * random invite-code alphabet never uses, so these can't collide with a
 * real user's generated code.
 */
async function seedFriendDemoIdentities(): Promise<void> {
  const synthetic = await prisma.user.findMany({ where: { isSynthetic: true }, select: { id: true, email: true } });
  const indexOf = (email: string) => Number(email.match(/synthetic\+(\d+)@/)?.[1] ?? NaN);
  const ordered = synthetic.filter((u) => !Number.isNaN(indexOf(u.email))).sort((a, b) => indexOf(a.email) - indexOf(b.email));

  let updated = 0;
  for (const [i, user] of ordered.entries()) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: DEMO_FRIEND_NAMES[i % DEMO_FRIEND_NAMES.length],
        inviteCode: `DEMO${String(i + 1).padStart(4, "0")}`,
      },
    });
    await prisma.friendSharing.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        shareInvestmentRate: "ALL",
        shareConsistency: "ALL",
        shareDiversification: "ALL",
        shareReturn: "ALL",
        shareMonthlyReturn: "ALL",
        shareHoldings: "ALL",
      },
      update: {
        shareInvestmentRate: "ALL",
        shareConsistency: "ALL",
        shareDiversification: "ALL",
        shareReturn: "ALL",
        shareMonthlyReturn: "ALL",
        shareHoldings: "ALL",
      },
    });
    updated += 1;
  }
  console.log(`[seed] friend demo identities: ${updated} synthetic users now have a display name, invite code (DEMO0001...) and sharing on.`);
}

/** Gives every synthetic peer an experience level (DECISIONS.md #18). Peers created before the
 * field existed all carry the column default (BEGINNER); this sets each from the same
 * per-peer stream a fresh seed uses, so the result is identical to re-seeding, without
 * deleting and recreating anyone (which would drop friend links to the demo users).
 * Safe to re-run: it always writes the value the seed would produce. */
async function backfillSyntheticExperience(): Promise<void> {
  const peers = await prisma.user.findMany({ where: { isSynthetic: true }, select: { id: true, email: true, profile: { select: { age: true, experienceLevel: true } } } });
  let changed = 0;
  for (const peer of peers) {
    const index = Number(peer.email.match(/synthetic\+(\d+)@/)?.[1] ?? NaN);
    if (Number.isNaN(index) || !peer.profile) continue;
    const level = assignExperience(peer.profile.age, experienceStream(POPULATION_SEED, index)());
    if (level !== peer.profile.experienceLevel) {
      await prisma.userProfile.update({ where: { userId: peer.id }, data: { experienceLevel: level } });
      changed += 1;
    }
  }
  console.log(`[seed] synthetic experience levels: ${changed} updated, ${peers.length - changed} already correct.`);
}

async function main() {
  const args = parseArgs();
  await seedPresetPortfolios();
  const generated = await seedSyntheticPeers(args);
  if (!generated) await refreshSyntheticPlans();
  await backfillSyntheticExperience();
  await seedFriendDemoIdentities();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
