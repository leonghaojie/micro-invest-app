/**
 * FundDataUpdateService - keeps the fund catalog's monthly history current
 * (DECISIONS.md #15). Until now new months only arrived when someone ran the
 * ingest scripts by hand, so every plan, dashboard and peer comparison was
 * frozen at whatever month that last happened.
 *
 * The job, run by the scheduler (jobs/fundDataScheduler.ts) or by hand:
 *   1. work out the latest COMPLETE month (last month; the current one is open);
 *   2. compare it with the oldest "latest month" across funds - if nothing is
 *      missing, stop: no network call, nothing written;
 *   3. otherwise fetch fresh data, load it (new months are inserted, changed
 *      ones corrected, implausible ones rejected), and check there are no gaps;
 *   4. recompute every user's plan, so plans and peer comparisons all move to
 *      the new month together instead of mixing fresh and stale months.
 *
 * Prices come from the same source and settings as the original history
 * (yfinance, unadjusted close + dividends), so new months are consistent with
 * old ones.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../config/prisma";
import { deriveMonthlyReturns, DerivedReturn, findGaps, lastCompleteMonth, monthKey, monthsBetween, RawRow } from "../utils/fundIngest";
import { planService } from "./plan.service";

export const DATA_DIR = join(__dirname, "..", "..", "prisma", "yfinance-data");

interface RawTicker {
  symbol: string;
  exchange: string;
  name: string;
  assetClass: string;
  currency: string;
  rows: RawRow[];
}

export interface LoadResult {
  funds: number;
  newMonths: number;
  revisedMonths: number;
  rejected: number;
  gaps: { ticker: string; months: string[] }[];
}

export type UpdateStatus = "up-to-date" | "updated" | "no-new-data" | "failed" | "already-running";

export interface UpdateSummary {
  status: UpdateStatus;
  /** The latest month that has fully ended. */
  expectedMonth: string;
  /** Oldest "latest month" across funds, before and after the run. */
  latestBefore: string | null;
  latestAfter: string | null;
  load: LoadResult | null;
  plansRefreshed: number;
  error?: string;
}

/** The month the laggard fund has data to: min over funds of their newest month. */
export async function oldestLatestMonth(): Promise<string | null> {
  const funds = await prisma.fund.findMany({
    select: { monthlyReturns: { orderBy: { monthDate: "desc" }, take: 1, select: { monthDate: true } } },
  });
  const latest = funds.map((f) => (f.monthlyReturns[0] ? monthKey(f.monthlyReturns[0].monthDate) : null));
  if (latest.length === 0 || latest.some((m) => m === null)) return null;
  return (latest as string[]).reduce((min, m) => (m < min ? m : min));
}

/** Reads the raw files the Python step wrote and applies them. Safe to re-run:
 * existing months are only touched if a value actually changed. */
export async function loadFundDataFromDir(dir: string, now: Date = new Date()): Promise<LoadResult> {
  const manifest: string[] = JSON.parse(readFileSync(join(dir, "_manifest.json"), "utf-8"));
  const result: LoadResult = { funds: 0, newMonths: 0, revisedMonths: 0, rejected: 0, gaps: [] };

  for (const symbol of manifest) {
    const raw: RawTicker = JSON.parse(readFileSync(join(dir, `${symbol}.json`), "utf-8"));
    const { returns, rejected } = deriveMonthlyReturns(raw.rows, now);
    for (const r of rejected) console.warn(`[fund-data] ${raw.symbol} ${r.month} rejected: ${r.reason}`);
    result.rejected += rejected.length;

    const fund = await prisma.fund.upsert({
      where: { ticker_exchange: { ticker: raw.symbol, exchange: raw.exchange } },
      create: { ticker: raw.symbol, exchange: raw.exchange, name: raw.name, assetClass: raw.assetClass, currency: raw.currency, dataSource: "YFINANCE" },
      update: { name: raw.name, assetClass: raw.assetClass, currency: raw.currency, dataSource: "YFINANCE" },
    });
    result.funds += 1;

    const existing = await prisma.fundMonthlyReturn.findMany({ where: { fundId: fund.id } });
    const byMonth = new Map(existing.map((e) => [monthKey(e.monthDate), e]));

    const toCreate: DerivedReturn[] = [];
    const toRevise: { id: string; r: DerivedReturn }[] = [];
    for (const r of returns) {
      const e = byMonth.get(r.month);
      if (!e) toCreate.push(r);
      else if (
        // Compare at the precision the values are STORED at. Comparing the raw float
        // with a tolerance misfires on prices like 44.40625 (stored as 44.4063): the
        // rounding gap is exactly the tolerance, so an unchanged month looked revised.
        Number(e.startPrice) !== Number(r.startPrice.toFixed(4)) ||
        Number(e.endPrice) !== Number(r.endPrice.toFixed(4)) ||
        Number(e.dividendAmount) !== Number(r.dividendAmount.toFixed(4)) ||
        Number(e.returnPct) !== Number(r.returnPct.toFixed(6))
      ) {
        toRevise.push({ id: e.id, r });
      }
    }

    if (toCreate.length > 0) {
      await prisma.fundMonthlyReturn.createMany({
        data: toCreate.map((r) => ({
          fundId: fund.id,
          monthDate: r.monthDate,
          startPrice: r.startPrice.toFixed(4),
          endPrice: r.endPrice.toFixed(4),
          dividendAmount: r.dividendAmount.toFixed(4),
          returnPct: r.returnPct.toFixed(6),
        })),
        skipDuplicates: true,
      });
    }
    for (const { id, r } of toRevise) {
      await prisma.fundMonthlyReturn.update({
        where: { id },
        data: {
          startPrice: r.startPrice.toFixed(4),
          endPrice: r.endPrice.toFixed(4),
          dividendAmount: r.dividendAmount.toFixed(4),
          returnPct: r.returnPct.toFixed(6),
        },
      });
    }
    result.newMonths += toCreate.length;
    result.revisedMonths += toRevise.length;

    // History is expected to be gap-free (the fund detail screen and the plan
    // engine rely on it): report, loudly, if a load ever leaves a hole.
    const all = await prisma.fundMonthlyReturn.findMany({ where: { fundId: fund.id }, orderBy: { monthDate: "asc" }, select: { monthDate: true } });
    const gaps = findGaps(all.map((m) => monthKey(m.monthDate)));
    if (gaps.length > 0) {
      console.error(`[fund-data] ${raw.symbol} has gaps in its history: ${gaps.join(", ")}`);
      result.gaps.push({ ticker: raw.symbol, months: gaps });
    }

    console.log(`[fund-data] ${raw.symbol}: +${toCreate.length} new, ${toRevise.length} revised${rejected.length ? `, ${rejected.length} rejected` : ""}.`);
  }
  return result;
}

/** Recomputes every plan against the current data, a few at a time. Plans are
 * stored as rows that are rebuilt on read; doing it here keeps peer statistics
 * (which read the stored rows) in step with the new month. */
export async function refreshAllPlans(concurrency = 8): Promise<number> {
  const plans = await prisma.plan.findMany({ select: { userId: true } });
  let refreshed = 0;
  for (let i = 0; i < plans.length; i += concurrency) {
    await Promise.all(
      plans.slice(i, i + concurrency).map(async ({ userId }) => {
        try {
          await planService.getActivePlan(userId);
          refreshed += 1;
        } catch (err) {
          console.error(`[fund-data] could not refresh a plan: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
    );
  }
  return refreshed;
}

export interface RunOptions {
  /** Fetches fresh raw data and returns the directory it was written to. */
  fetchRaw: () => Promise<string>;
  /** Run even if nothing looks missing (manual refresh). */
  force?: boolean;
  now?: Date;
}

let running = false;

/** One update attempt. Never throws: a failure is reported in the summary so the
 * scheduler can retry later. Only one runs at a time. */
export async function runFundDataUpdate({ fetchRaw, force = false, now = new Date() }: RunOptions): Promise<UpdateSummary> {
  const expectedMonth = lastCompleteMonth(now);
  const summary: UpdateSummary = { status: "up-to-date", expectedMonth, latestBefore: null, latestAfter: null, load: null, plansRefreshed: 0 };

  if (running) return { ...summary, status: "already-running" };
  running = true;
  try {
    summary.latestBefore = await oldestLatestMonth();
    const behind = summary.latestBefore === null ? true : monthsBetween(summary.latestBefore, expectedMonth) > 0;
    if (!behind && !force) {
      summary.latestAfter = summary.latestBefore;
      return summary;
    }

    console.log(
      `[fund-data] ${summary.latestBefore ? `data ends ${summary.latestBefore}` : "no fund data yet"}, latest complete month is ${expectedMonth} - fetching...`
    );
    const dir = await fetchRaw();
    summary.load = await loadFundDataFromDir(dir, now);
    summary.latestAfter = await oldestLatestMonth();

    const changed = summary.load.newMonths + summary.load.revisedMonths > 0;
    if (changed) {
      summary.plansRefreshed = await refreshAllPlans();
      summary.status = "updated";
      console.log(`[fund-data] updated: data now ends ${summary.latestAfter}; ${summary.plansRefreshed} plans refreshed.`);
    } else {
      summary.status = "no-new-data";
      console.log(`[fund-data] fetched, but nothing new is available yet (data still ends ${summary.latestAfter}).`);
    }
    return summary;
  } catch (err) {
    summary.status = "failed";
    summary.error = err instanceof Error ? err.message : String(err);
    console.error(`[fund-data] update failed: ${summary.error}`);
    return summary;
  } finally {
    running = false;
  }
}
