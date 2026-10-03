/**
 * PeerInsightsService — DECISIONS.md #9 (peer dashboard views, 3 Oct 2026).
 *
 * The richer peer statistics behind GET /peers/dashboard: a distribution
 * (histogram + the user's exact percentile), a trajectory (peer median and
 * p25–p75 band by months since start) and an allocation panel (what peers
 * hold). Aggregate-only, like everything in /peers/* (NFR-03), with two
 * guards beyond the group-size rule enforced by peerGrouping.service.ts:
 *  - MIN_GROUP_SIZE (env): a trajectory month with fewer than that many
 *    peers is dropped; a segment with fewer peers has no statistics at all;
 *  - MIN_CELL_COUNT: histogram bins and "held by X% of peers" funds with
 *    fewer than 3 members are merged / withheld, so no cell describes one
 *    or two identifiable people.
 *
 * All aggregation is pushed into PostgreSQL (percentile_cont, width_bucket,
 * window functions) rather than loading peers into JS — Decision #5 — via one
 * shared peer-population fragment, so every panel describes exactly the same
 * group. SQL expressions that vary by metric come from fixed whitelists, never
 * from request text. The older /peers/summary logic in peerBenchmark.service.ts
 * is untouched.
 */
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { describeSegment, PeerGroupAssignment, PeerDimension } from "./peerGrouping.service";

// ── Constants & types ──────────────────────────────────────────────────

export const MIN_CELL_COUNT = 3;
const HISTOGRAM_BINS = 10;
const TOP_FUNDS = 5;

export const PEER_METRICS = ["value", "returnPct", "contributionRatePct", "savingsRatePct", "emergencyBuffer"] as const;
export type PeerMetric = (typeof PEER_METRICS)[number];

// Metrics that change month to month, so a trajectory is meaningful.
const TRAJECTORY_METRICS: readonly PeerMetric[] = ["value", "returnPct", "emergencyBuffer"];

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface Distribution {
  /** Variable-width bins (small ones are merged), already privacy-safe. */
  bins: HistogramBin[];
  p25: number;
  p50: number;
  p75: number;
  /** Axis bounds (5th–95th percentile); values beyond are grouped into the end bins. */
  lo: number;
  hi: number;
  peerCount: number;
}

export interface TrajectoryPoint {
  /** Months since the plan started (1 = first month). */
  k: number;
  p25: number;
  p50: number;
  p75: number;
  mine: number | null;
}

export interface MixEntry {
  assetClass: string;
  pct: number;
}

export interface Allocation {
  peerMix: MixEntry[];
  topFunds: { ticker: string; name: string; heldByPct: number }[];
  avgHoldings: number;
  myMix: MixEntry[];
}

export interface PeerDashboard {
  group: {
    dims: PeerDimension[];
    bandPct: number | null;
    ageRange: { lo: number; hi: number } | null;
    /** Exact only when the segment is large enough; null when suppressed. */
    memberCount: number | null;
    suppressed: boolean;
    message: string;
  };
  metric: PeerMetric;
  me: { value: number | null; percentileRank: number | null };
  distribution: Distribution | null;
  trajectory: TrajectoryPoint[] | null;
  allocation: Allocation | null;
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────

/** Turns equal-width bucket counts into bins, merging any bin holding 1 or 2
 * members into its smaller neighbour (repeatedly) so no bar describes one or
 * two identifiable people. Empty bins stay empty — they say nothing about
 * anyone. */
export function buildHistogram(lo: number, hi: number, counts: number[], minCell: number = MIN_CELL_COUNT): HistogramBin[] {
  const width = (hi - lo) / counts.length;
  const bins: HistogramBin[] = counts.map((count, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count }));

  while (bins.length > 1) {
    const i = bins.findIndex((b) => b.count > 0 && b.count < minCell);
    if (i === -1) break;

    const left = bins[i - 1];
    const right = bins[i + 1];
    const mergeWithLeft = left !== undefined && (right === undefined || left.count <= right.count);
    const [a, b] = mergeWithLeft ? [bins[i - 1], bins[i]] : [bins[i], bins[i + 1]];
    bins.splice(mergeWithLeft ? i - 1 : i, 2, { from: a.from, to: b.to, count: a.count + b.count });
  }
  return bins;
}

/** Mid-rank percentile: the share of peers below the user plus half of
 * those tied with them. Null when the user has no figure or there are no peers. */
export function percentileRank(below: number, equal: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round(((below + equal / 2) / total) * 1000) / 10;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

// ── SQL building blocks ────────────────────────────────────────────────

// Each plan's latest month — the snapshot peers are compared on.
const LATEST = Prisma.sql`
  latest AS (
    SELECT DISTINCT ON (p."userId")
      p.id AS plan_id, p."userId", p."portfolioId", p."contributionAmount", p."startMonth",
      pm."endingBalance", pm."totalInvested", pm."walletBalance"
    FROM plans p
    JOIN plan_months pm ON pm."planId" = p.id
    ORDER BY p."userId", pm."monthDate" DESC
  )`;

/** `peers`: the segment's members — other users with a profile and active
 * plan, narrowed by exactly the filters peerGrouping resolved. */
function peersCte(userId: string, group: PeerGroupAssignment): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`l."userId" <> ${userId}`];
  if (group.bandPct !== null) conds.push(Prisma.sql`up."monthlyIncome" BETWEEN ${group.lo} AND ${group.hi}`);
  const f = group.filters ?? {};
  if (f.age) conds.push(Prisma.sql`up.age BETWEEN ${f.age.lo} AND ${f.age.hi}`);
  if (f.riskLevel) conds.push(Prisma.sql`up."riskLevel" = ${f.riskLevel}::"RiskLevel"`);
  if (f.goalType) conds.push(Prisma.sql`up."goalType" = ${f.goalType}::"GoalType"`);
  if (f.startMonth) conds.push(Prisma.sql`l."startMonth" = ${f.startMonth}`);

  return Prisma.sql`${LATEST},
  peers AS (
    SELECT l.plan_id, l."userId", l."portfolioId", l."contributionAmount", l."startMonth",
           l."endingBalance", l."totalInvested", l."walletBalance",
           up."monthlyIncome", up."monthlyExpense"
    FROM latest l
    JOIN user_profiles up ON up."userId" = l."userId"
    WHERE ${Prisma.join(conds, " AND ")}
  )`;
}

// Per-metric SQL over a row exposing the snapshot columns (peers / me CTEs).
const SNAPSHOT_SQL: Record<PeerMetric, Prisma.Sql> = {
  value: Prisma.sql`"endingBalance"`,
  returnPct: Prisma.sql`(("endingBalance" - "totalInvested") / NULLIF("totalInvested", 0) * 100)`,
  contributionRatePct: Prisma.sql`("contributionAmount" / NULLIF("monthlyIncome", 0) * 100)`,
  savingsRatePct: Prisma.sql`(("monthlyIncome" - "monthlyExpense") / NULLIF("monthlyIncome", 0) * 100)`,
  emergencyBuffer: Prisma.sql`("walletBalance" / NULLIF("monthlyExpense", 0))`,
};

// Per-metric SQL over a single plan month (aliases: pm = plan_months, up = user_profiles).
const SERIES_SQL: Partial<Record<PeerMetric, Prisma.Sql>> = {
  value: Prisma.sql`pm."endingBalance"`,
  returnPct: Prisma.sql`((pm."endingBalance" - pm."totalInvested") / NULLIF(pm."totalInvested", 0) * 100)`,
  emergencyBuffer: Prisma.sql`(pm."walletBalance" / NULLIF(up."monthlyExpense", 0))`,
};

interface DistributionRow {
  n: number;
  lo: unknown;
  hi: unknown;
  p25: unknown;
  p50: unknown;
  p75: unknown;
  below: number;
  equal: number;
  buckets: { bucket: number; count: number }[] | null;
}

class PeerInsightsService {
  /** The user's own latest figure for a metric (null with no plan). */
  private async myValue(userId: string, metric: PeerMetric): Promise<number | null> {
    const rows = await prisma.$queryRaw<{ v: unknown }[]>`
      WITH ${LATEST},
      me AS (
        SELECT l.*, up."monthlyIncome", up."monthlyExpense"
        FROM latest l JOIN user_profiles up ON up."userId" = l."userId"
        WHERE l."userId" = ${userId}
      )
      SELECT ${SNAPSHOT_SQL[metric]} AS v FROM me`;
    return num(rows[0]?.v);
  }

  private async distribution(userId: string, group: PeerGroupAssignment, metric: PeerMetric, mine: number | null): Promise<{ distribution: Distribution | null; rank: number | null }> {
    const expr = SNAPSHOT_SQL[metric];
    const rows = await prisma.$queryRaw<DistributionRow[]>`
      WITH ${peersCte(userId, group)},
      vals AS (SELECT ${expr} AS v FROM peers),
      present AS (SELECT v FROM vals WHERE v IS NOT NULL),
      bounds AS (
        SELECT
          COUNT(*)::int AS n,
          percentile_cont(0.05) WITHIN GROUP (ORDER BY v) AS lo,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY v) AS hi_raw,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS p25,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY v) AS p50,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS p75,
          COUNT(*) FILTER (WHERE v < ${mine}::numeric)::int AS below,
          COUNT(*) FILTER (WHERE v = ${mine}::numeric)::int AS equal
        FROM present
      ),
      adj AS (SELECT *, CASE WHEN hi_raw > lo THEN hi_raw ELSE lo + 1 END AS hi FROM bounds)
      SELECT adj.n, adj.lo, adj.hi, adj.p25, adj.p50, adj.p75, adj.below, adj.equal,
        (SELECT json_agg(json_build_object('bucket', t.b, 'count', t.c) ORDER BY t.b)
         FROM (
           SELECT LEAST(width_bucket(LEAST(GREATEST(v, adj.lo), adj.hi), adj.lo, adj.hi, ${HISTOGRAM_BINS}::int), ${HISTOGRAM_BINS}::int) AS b,
                  COUNT(*)::int AS c
           FROM present GROUP BY 1
         ) t) AS buckets
      FROM adj`;

    const row = rows[0];
    // Too few peers have a figure for this metric (e.g. nobody has contributed yet).
    if (!row || row.n < env.minGroupSize) return { distribution: null, rank: null };

    const lo = Number(row.lo);
    const hi = Number(row.hi);
    const counts = new Array<number>(HISTOGRAM_BINS).fill(0);
    for (const b of row.buckets ?? []) counts[b.bucket - 1] = b.count;

    return {
      distribution: {
        bins: buildHistogram(lo, hi, counts).map((b) => ({ from: round(b.from), to: round(b.to), count: b.count })),
        p25: round(Number(row.p25)),
        p50: round(Number(row.p50)),
        p75: round(Number(row.p75)),
        lo: round(lo),
        hi: round(hi),
        peerCount: row.n,
      },
      rank: mine === null ? null : percentileRank(row.below, row.equal, row.n),
    };
  }

  private async trajectory(userId: string, group: PeerGroupAssignment, metric: PeerMetric): Promise<TrajectoryPoint[] | null> {
    const series = SERIES_SQL[metric];
    if (!series || !TRAJECTORY_METRICS.includes(metric)) return null;

    const [peerRows, myRows] = await Promise.all([
      prisma.$queryRaw<{ k: number; p25: unknown; p50: unknown; p75: unknown }[]>`
        WITH ${peersCte(userId, group)},
        points AS (
          SELECT row_number() OVER (PARTITION BY pm."planId" ORDER BY pm."monthDate")::int AS k,
                 ${series} AS v
          FROM plan_months pm
          JOIN peers ON peers.plan_id = pm."planId"
          JOIN user_profiles up ON up."userId" = peers."userId"
        )
        SELECT k,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS p25,
               percentile_cont(0.50) WITHIN GROUP (ORDER BY v) AS p50,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS p75
        FROM points
        WHERE v IS NOT NULL
        GROUP BY k
        HAVING COUNT(*) >= ${env.minGroupSize}
        ORDER BY k`,
      prisma.$queryRaw<{ k: number; v: unknown }[]>`
        SELECT row_number() OVER (ORDER BY pm."monthDate")::int AS k, ${series} AS v
        FROM plan_months pm
        JOIN plans p ON p.id = pm."planId"
        JOIN user_profiles up ON up."userId" = p."userId"
        WHERE p."userId" = ${userId}
        ORDER BY pm."monthDate"`,
    ]);

    if (peerRows.length === 0) return null;
    const mine = new Map(myRows.map((r) => [r.k, num(r.v)]));
    return peerRows.map((r) => ({
      k: r.k,
      p25: round(Number(r.p25)),
      p50: round(Number(r.p50)),
      p75: round(Number(r.p75)),
      mine: mine.get(r.k) ?? null,
    }));
  }

  private async allocation(userId: string, group: PeerGroupAssignment): Promise<Allocation> {
    const [mixRows, fundRows, holdingRows, myPlan] = await Promise.all([
      prisma.$queryRaw<{ assetClass: string; avg_weight: unknown }[]>`
        WITH ${peersCte(userId, group)}
        SELECT f."assetClass", SUM(pa."weightPct") / (SELECT COUNT(*) FROM peers) AS avg_weight
        FROM peers
        JOIN portfolio_allocations pa ON pa."portfolioId" = peers."portfolioId"
        JOIN funds f ON f.id = pa."fundId"
        GROUP BY f."assetClass"
        ORDER BY avg_weight DESC`,
      prisma.$queryRaw<{ ticker: string; name: string; holders: number; n: number }[]>`
        WITH ${peersCte(userId, group)}
        SELECT f.ticker, f.name, COUNT(DISTINCT peers."userId")::int AS holders, (SELECT COUNT(*)::int FROM peers) AS n
        FROM peers
        JOIN portfolio_allocations pa ON pa."portfolioId" = peers."portfolioId"
        JOIN funds f ON f.id = pa."fundId"
        GROUP BY f.id, f.ticker, f.name
        HAVING COUNT(DISTINCT peers."userId") >= ${MIN_CELL_COUNT}
        ORDER BY holders DESC, f.ticker
        LIMIT ${TOP_FUNDS}`,
      prisma.$queryRaw<{ avg_holdings: unknown }[]>`
        WITH ${peersCte(userId, group)}
        SELECT AVG(c)::float AS avg_holdings FROM (
          SELECT COUNT(*) AS c FROM peers
          JOIN portfolio_allocations pa ON pa."portfolioId" = peers."portfolioId"
          GROUP BY peers."userId"
        ) x`,
      prisma.plan.findUnique({
        where: { userId },
        include: { portfolio: { include: { allocations: { include: { fund: { select: { assetClass: true } } } } } } },
      }),
    ]);

    const myTotals = new Map<string, number>();
    for (const a of myPlan?.portfolio.allocations ?? []) {
      myTotals.set(a.fund.assetClass, (myTotals.get(a.fund.assetClass) ?? 0) + Number(a.weightPct));
    }

    return {
      peerMix: mixRows.map((r) => ({ assetClass: r.assetClass, pct: round(Number(r.avg_weight), 1) })),
      topFunds: fundRows.map((r) => ({ ticker: r.ticker, name: r.name, heldByPct: round((r.holders / r.n) * 100, 0) })),
      avgHoldings: round(Number(holdingRows[0]?.avg_holdings ?? 0), 1),
      myMix: [...myTotals.entries()].map(([assetClass, pct]) => ({ assetClass, pct: round(pct, 1) })).sort((a, b) => b.pct - a.pct),
    };
  }

  async getDashboard(userId: string, group: PeerGroupAssignment, metric: PeerMetric): Promise<PeerDashboard> {
    const suppressed = group.suppressed === true;
    const groupInfo: PeerDashboard["group"] = {
      dims: group.dims ?? ["income"],
      bandPct: group.bandPct,
      ageRange: group.filters?.age ?? null,
      // Exact only when large enough to be a safe aggregate; never a small count.
      memberCount: suppressed ? null : group.memberCount,
      suppressed,
      message: describeSegment(group),
    };

    const mine = await this.myValue(userId, metric);

    if (suppressed) {
      return { group: groupInfo, metric, me: { value: mine, percentileRank: null }, distribution: null, trajectory: null, allocation: null };
    }

    const [{ distribution, rank }, trajectory, allocation] = await Promise.all([
      this.distribution(userId, group, metric, mine),
      this.trajectory(userId, group, metric),
      this.allocation(userId, group),
    ]);

    return { group: groupInfo, metric, me: { value: mine, percentileRank: rank }, distribution, trajectory, allocation };
  }
}

export const peerInsightsService = new PeerInsightsService();
