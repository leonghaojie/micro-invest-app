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
 * 1. Preset portfolios — one single-fund, 100%-weight Portfolio per
 *    catalog fund (Conservative/Balanced/Growth on the three SGX funds
 *    this project has always tracked), same shape as before
 *    (DECISIONS.md #1 second amendment). Users can still build their own
 *    multi-fund Portfolio instead (portfolio.service.ts).
 *
 * 2. Synthetic peer data (SRS §2.6, DECISIONS.md #4) — populates a spread
 *    of incomes (not the old riskLevel x budgetBand x goalType grid, which
 *    no longer exists) so the income-range peer grouping
 *    (peerGrouping.service.ts, DECISIONS.md #2 rewrite) has something to
 *    find at every widening step, plus a Plan per synthetic user so
 *    peerBenchmark.service.ts's percentiles aren't empty either.
 */
import { PrismaClient, RiskLevel, GoalType } from "@prisma/client";
import { planService } from "../src/services/plan.service";

const prisma = new PrismaClient();

const PRESET_PORTFOLIOS: { name: string; riskLevel: RiskLevel; ticker: string; exchange: string }[] = [
  { name: "Conservative", riskLevel: RiskLevel.LOW, ticker: "A35.SI", exchange: "SGX" },
  { name: "Balanced", riskLevel: RiskLevel.MEDIUM, ticker: "CFA.SI", exchange: "SGX" },
  { name: "Growth", riskLevel: RiskLevel.HIGH, ticker: "ES3.SI", exchange: "SGX" },
];

// Spread of synthetic monthly incomes (SGD) — deliberately clustered with
// some outliers, so the ±10%/±15%/.../widening algorithm has to actually
// widen for some users and not others when exercised in a demo or test.
const SYNTHETIC_INCOMES = [
  2200, 2300, 2400, 2450, 2500, 2550, 2600, 2650, 2700, 2800,
  3200, 3300, 3400, 3500, 3600, 3700, 3800,
  5000, 5200, 5500,
  9000, 12000,
];

async function seedPresetPortfolios(): Promise<void> {
  let created = 0;
  for (const preset of PRESET_PORTFOLIOS) {
    const existing = await prisma.portfolio.findFirst({ where: { name: preset.name, isPreset: true } });
    if (existing) continue;

    const fund = await prisma.fund.findUnique({
      where: { ticker_exchange: { ticker: preset.ticker, exchange: preset.exchange } },
    });
    if (!fund) {
      console.warn(
        `[seed] skipping preset "${preset.name}" — fund ${preset.ticker}.${preset.exchange} not found. ` +
          "Run `npm run prisma:ingest-funds` first."
      );
      continue;
    }

    await prisma.portfolio.create({
      data: {
        name: preset.name,
        riskLevel: preset.riskLevel,
        isPreset: true,
        userId: null,
        allocations: { create: [{ fundId: fund.id, weightPct: "100.00" }] },
      },
    });
    created += 1;
  }
  console.log(`[seed] preset portfolios: ${created} created, ${PRESET_PORTFOLIOS.length - created} already present/skipped.`);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function seedSyntheticPeers(): Promise<void> {
  const existingCount = await prisma.user.count({ where: { isSynthetic: true } });
  if (existingCount > 0) {
    console.log(`[seed] synthetic peers: ${existingCount} already present, skipping.`);
    return;
  }

  const presets = await prisma.portfolio.findMany({ where: { isPreset: true } });
  if (presets.length === 0) {
    console.warn("[seed] synthetic peers: no preset portfolios found, skipping.");
    return;
  }

  // Earliest month every preset's own single fund has data for, so a
  // synthetic startMonth is always valid (plan.service.ts validates this
  // the same way for real users).
  let created = 0;
  for (let i = 0; i < SYNTHETIC_INCOMES.length; i++) {
    const income = SYNTHETIC_INCOMES[i];
    const expense = Math.round(income * (0.4 + Math.random() * 0.35)); // 40-75% of income
    const email = `synthetic+${i}@seed.local`;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: "synthetic-not-a-real-login",
        isSynthetic: true,
        profile: {
          create: {
            riskLevel: pick([RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH]),
            goalType: pick([GoalType.LEARN, GoalType.HABIT, GoalType.GROWTH]),
            monthlyIncome: income,
            monthlyExpense: expense,
            age: 21 + Math.floor(Math.random() * 40),
          },
        },
      },
    });

    const portfolio = pick(presets);
    const contribution = Math.max(10, Math.round(income * 0.05));
    // Start somewhere in the last ~18 months so there's a real, if short,
    // history to compare against.
    const now = new Date();
    const monthsBack = 3 + Math.floor(Math.random() * 15);
    const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));

    try {
      await planService.startPlan(user.id, { portfolioId: portfolio.id, contributionAmount: contribution, startMonth: startMonth.toISOString() });
      created += 1;
    } catch (err) {
      console.warn(`[seed] synthetic peer ${email}: plan creation failed (${(err as Error).message}), left without a plan.`);
    }
  }

  console.log(`[seed] synthetic peers: ${created}/${SYNTHETIC_INCOMES.length} created with a plan.`);
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
        shareValue: true,
        shareReturn: true,
        shareContributionRate: true,
        shareSavingsRate: true,
        shareEmergencyBuffer: true,
      },
      update: {
        shareValue: true,
        shareReturn: true,
        shareContributionRate: true,
        shareSavingsRate: true,
        shareEmergencyBuffer: true,
      },
    });
    updated += 1;
  }
  console.log(`[seed] friend demo identities: ${updated} synthetic users now have a display name, invite code (DEMO0001...) and sharing on.`);
}

async function main() {
  await seedPresetPortfolios();
  await seedSyntheticPeers();
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
