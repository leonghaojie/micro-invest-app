/**
 * Schedules the fund data update (DECISIONS.md #15). It does NOT poll.
 *
 * The data only changes once a month - when a calendar month ends and its
 * final prices exist - so the scheduler sleeps until the start of the next month
 * and wakes then, instead of checking every few hours:
 *
 *   server start      one catch-up check (a server that was off over a month-end
 *                     still catches up). It only fetches if a month is missing.
 *   1st of the month  a check shortly after 00:00 UTC, when the previous month has
 *                     ended in every market the funds trade in.
 *   after an update   sleep until the 1st of the NEXT month.
 *   if it did not work (Yahoo not ready yet, a network error) it retries a few
 *                     times with growing gaps over the first days of the month,
 *                     then gives up until next month - it never loops.
 *
 * The sleep is a plain timer, so between wake-ups the process does nothing. Node
 * caps a single timer at about 24.8 days, so a month-long sleep is split into
 * chunks; those intermediate wake-ups only re-arm the timer, no check is made.
 */
import type { UpdateSummary } from "../services/fundDataUpdate.service";

/** How long after 00:00 UTC on the 1st the monthly check runs. By then the previous
 * month has closed on SGX (09:00 UTC) and on the US exchanges (~21:00 UTC). */
export const MONTH_START_GRACE_MS = 30 * 60 * 1000;

/** Waits between retries within a month, after an attempt that did not complete:
 * 1h, 3h, 6h, 12h, 24h - about two days in all, then it waits for next month. */
export const RETRY_DELAYS_MS = [1, 3, 6, 12, 24].map((h) => h * 60 * 60 * 1000);

/** setTimeout cannot take more than 2^31-1 ms (about 24.8 days). */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** The moment of the next monthly check: the 1st of the month after `now`, plus the grace. UTC. */
export function nextMonthlyCheck(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0) + MONTH_START_GRACE_MS);
}

export interface SchedulerOptions {
  run: () => Promise<UpdateSummary>;
  startupDelayMs?: number;
  log?: (message: string) => void;
}

export interface Scheduler {
  stop: () => void;
}

export function startFundDataScheduler({ run, startupDelayMs = 15_000, log = console.log }: SchedulerOptions): Scheduler {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retriesUsed = 0;

  /** Sleep until `target`, in chunks no longer than a timer can hold, then call `then`. */
  const sleepUntil = (target: Date, then: () => void) => {
    if (stopped) return;
    const remaining = target.getTime() - Date.now();
    if (remaining <= 0) return then();
    timer = setTimeout(() => sleepUntil(target, then), Math.min(remaining, MAX_TIMER_MS));
    timer.unref(); // never keep the process alive just for this
  };

  const sleepUntilNextMonth = () => {
    const next = nextMonthlyCheck(new Date());
    retriesUsed = 0;
    log(`[fund-data] next check: ${next.toISOString().slice(0, 16).replace("T", " ")} UTC (start of next month).`);
    sleepUntil(next, () => check());
  };

  const check = async () => {
    if (stopped) return;
    let summary: UpdateSummary;
    try {
      summary = await run();
    } catch (err) {
      // run() is not expected to throw; if it does, treat it like a failed attempt.
      console.error("[fund-data] scheduler error:", err);
      summary = { status: "failed", expectedMonth: "", latestBefore: null, latestAfter: null, load: null, plansRefreshed: 0 };
    }
    if (stopped) return;

    const done = summary.status === "updated" || summary.status === "up-to-date" || summary.status === "already-running";
    if (done) return sleepUntilNextMonth();

    // Not done: Yahoo had nothing new yet, or the fetch failed. Retry a few times, then wait for next month.
    if (retriesUsed < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[retriesUsed];
      retriesUsed += 1;
      log(`[fund-data] ${summary.status}; retry ${retriesUsed}/${RETRY_DELAYS_MS.length} in ${delay / 3_600_000}h.`);
      sleepUntil(new Date(Date.now() + delay), () => check());
    } else {
      log(`[fund-data] ${summary.status}; no more retries this month.`);
      sleepUntilNextMonth();
    }
  };

  // Catch-up check shortly after the server starts.
  timer = setTimeout(() => check(), startupDelayMs);
  timer.unref();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
