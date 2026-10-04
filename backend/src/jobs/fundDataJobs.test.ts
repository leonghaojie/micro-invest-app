/**
 * The scheduler's timing and back-off, and the Python fetcher's failure
 * messages (DECISIONS.md #15). The child process is faked: no Python, no network.
 */
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { startFundDataScheduler, nextMonthlyCheck, MONTH_START_GRACE_MS, RETRY_DELAYS_MS } from "./fundDataScheduler";
import { fetchWithPython } from "./pythonFetcher";
import type { UpdateSummary } from "../services/fundDataUpdate.service";

// The fetcher only needs DATA_DIR from the service and pythonBin from env. Stubbing them keeps
// Prisma (which itself uses child_process at import time) out of this suite.
jest.mock("../services/fundDataUpdate.service", () => ({ DATA_DIR: "/app/prisma/yfinance-data" }));
jest.mock("../config/env", () => ({ env: { pythonBin: "python" } }));
jest.mock("child_process", () => ({ spawn: jest.fn() }));
jest.mock("fs", () => ({ ...jest.requireActual("fs"), existsSync: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const spawn = require("child_process").spawn as jest.Mock;
const exists = existsSync as unknown as jest.Mock;

const summary = (status: UpdateSummary["status"]): UpdateSummary => ({
  status,
  expectedMonth: "2026-09",
  latestBefore: "2026-07",
  latestAfter: "2026-07",
  load: null,
  plansRefreshed: 0,
});

describe("nextMonthlyCheck", () => {
  const iso = (d: Date) => d.toISOString();

  it("is the 1st of next month, a little after midnight UTC", () => {
    expect(iso(nextMonthlyCheck(new Date("2026-10-04T12:00:00Z")))).toBe("2026-11-01T00:30:00.000Z");
    expect(MONTH_START_GRACE_MS).toBe(30 * 60 * 1000);
  });

  it("rolls the year over in December", () => {
    expect(iso(nextMonthlyCheck(new Date("2026-12-15T00:00:00Z")))).toBe("2027-01-01T00:30:00.000Z");
  });

  it("handles month ends, including a leap February", () => {
    expect(iso(nextMonthlyCheck(new Date("2026-01-31T23:59:00Z")))).toBe("2026-02-01T00:30:00.000Z");
    expect(iso(nextMonthlyCheck(new Date("2028-02-29T12:00:00Z")))).toBe("2028-03-01T00:30:00.000Z");
  });

  it("is always strictly in the future, even on the 1st", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    expect(nextMonthlyCheck(now).getTime()).toBeGreaterThan(now.getTime());
    expect(iso(nextMonthlyCheck(now))).toBe("2026-12-01T00:30:00.000Z");
  });
});

describe("startFundDataScheduler: wakes once a month, never polls", () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-04T12:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  const start = (run: jest.Mock) => startFundDataScheduler({ run, startupDelayMs: 15_000, log: () => undefined });

  it("checks once after startup and then NOT again for weeks", async () => {
    const run = jest.fn().mockResolvedValue(summary("up-to-date"));
    const s = start(run);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(26 * DAY); // up to Oct 30
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("wakes just after the start of next month, across a sleep longer than a single timer can hold", async () => {
    const run = jest.fn().mockResolvedValue(summary("up-to-date"));
    const s = start(run);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1);

    // Oct 4 -> Nov 1 is ~27.5 days, more than the ~24.8 day timer limit
    jest.setSystemTime(new Date("2026-11-01T00:29:00Z"));
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30 * DAY); // well past it
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it("fires at the start of the month, not before (system clock moved to just before the boundary)", async () => {
    const run = jest.fn().mockResolvedValue(summary("updated"));
    jest.setSystemTime(new Date("2026-10-31T23:00:00Z"));
    const s = start(run);
    await jest.advanceTimersByTimeAsync(15_000); // startup catch-up
    expect(run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(HOUR); // 00:00:15 on Nov 1 - still inside the grace period
    expect(run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(MONTH_START_GRACE_MS); // now past 00:30
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it("after a successful update, sleeps until the month after", async () => {
    jest.setSystemTime(new Date("2026-10-31T23:59:00Z"));
    const run = jest.fn().mockResolvedValue(summary("updated"));
    const s = start(run);
    await jest.advanceTimersByTimeAsync(15_000 + HOUR); // startup + the Nov 1 check
    expect(run).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(25 * DAY); // through Nov 26
    expect(run).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(10 * DAY); // past Dec 1 00:30
    expect(run).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it("retries a fetch that did not work a few times, spaced out, then waits for next month instead of looping", async () => {
    const run = jest.fn().mockResolvedValue(summary("failed"));
    const s = start(run);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1);

    // retries at +1h, +3h, +6h, +12h, +24h after each previous attempt
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      await jest.advanceTimersByTimeAsync(RETRY_DELAYS_MS[i] - 1);
      expect(run).toHaveBeenCalledTimes(1 + i); // not yet
      await jest.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(2 + i);
    }

    // 1 initial + 5 retries; then nothing for the rest of the month
    expect(run).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
    await jest.advanceTimersByTimeAsync(20 * DAY);
    expect(run).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
    s.stop();
  });

  it("starts the retry sequence afresh each month", async () => {
    const run = jest.fn().mockResolvedValue(summary("failed"));
    const s = start(run);
    await jest.advanceTimersByTimeAsync(15_000 + 3 * DAY); // all retries used up
    const afterOctober = run.mock.calls.length;
    expect(afterOctober).toBe(1 + RETRY_DELAYS_MS.length);

    jest.setSystemTime(new Date("2026-11-01T00:29:50Z"));
    await jest.advanceTimersByTimeAsync(30 * DAY); // reaches the Nov 1 check and then its retries
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(afterOctober + 1 + RETRY_DELAYS_MS.length);
    s.stop();
  });

  it("treats 'nothing new yet' like a failed attempt (Yahoo may lag behind the month end)", async () => {
    const run = jest.fn().mockResolvedValueOnce(summary("no-new-data")).mockResolvedValue(summary("updated"));
    const s = start(run);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(run).toHaveBeenCalledTimes(2); // the retry found it

    await jest.advanceTimersByTimeAsync(20 * DAY); // and now it sleeps
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it("treats a run that is already in progress as handled", async () => {
    const run = jest.fn().mockResolvedValue(summary("already-running"));
    const s = start(run);
    await jest.advanceTimersByTimeAsync(15_000 + 5 * DAY);
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("survives the job throwing: logged, then handled like a failed attempt", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const run = jest.fn().mockRejectedValueOnce(new Error("unexpected")).mockResolvedValue(summary("updated"));
    const s = start(run);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(err).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(run).toHaveBeenCalledTimes(2);
    err.mockRestore();
    s.stop();
  });

  it("stop() cancels everything, whether sleeping or waiting to retry", async () => {
    const run = jest.fn().mockResolvedValue(summary("failed"));
    const s = start(run);
    await jest.advanceTimersByTimeAsync(15_000);
    s.stop();
    await jest.advanceTimersByTimeAsync(60 * DAY);
    expect(run).toHaveBeenCalledTimes(1);

    const run2 = jest.fn().mockResolvedValue(summary("up-to-date"));
    const s2 = start(run2);
    s2.stop();
    await jest.advanceTimersByTimeAsync(60 * DAY);
    expect(run2).not.toHaveBeenCalled();
  });

  it("says when it will next wake", async () => {
    const log = jest.fn();
    const run = jest.fn().mockResolvedValue(summary("up-to-date"));
    const s = startFundDataScheduler({ run, startupDelayMs: 100, log });
    await jest.advanceTimersByTimeAsync(100);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("2026-11-01 00:30 UTC"));
    s.stop();
  });
});

describe("fetchWithPython", () => {
  /** A fake child process the test can drive. */
  function fakeChild() {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: jest.Mock };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    spawn.mockReturnValue(child);
    return child;
  }

  beforeEach(() => {
    spawn.mockReset();
    exists.mockReset().mockReturnValue(true);
  });

  it("resolves with the data directory when the script succeeds", async () => {
    const child = fakeChild();
    const p = fetchWithPython({ pythonBin: "python", script: "x.py" });
    child.emit("close", 0);
    await expect(p).resolves.toMatch(/yfinance-data$/);
    expect(spawn).toHaveBeenCalledWith("python", ["x.py"], expect.objectContaining({ env: expect.objectContaining({ PYTHONIOENCODING: "utf-8" }) }));
  });

  it("says plainly when Python is not installed", async () => {
    const child = fakeChild();
    const p = fetchWithPython({ pythonBin: "python9" });
    child.emit("error", Object.assign(new Error("spawn python9 ENOENT"), { code: "ENOENT" }));
    await expect(p).rejects.toThrow(/Python was not found \("python9"\).*PYTHON_BIN/);
  });

  it("says plainly when yfinance is not installed", async () => {
    const child = fakeChild();
    const p = fetchWithPython();
    child.stderr.emit("data", Buffer.from("ModuleNotFoundError: No module named 'yfinance'"));
    child.emit("close", 1);
    await expect(p).rejects.toThrow(/pip install yfinance/);
  });

  it("includes the script's last output when it fails for another reason", async () => {
    const child = fakeChild();
    const p = fetchWithPython();
    child.stdout.emit("data", Buffer.from("[fetch] SPY... FAILED: HTTP 429"));
    child.emit("close", 2);
    await expect(p).rejects.toThrow(/code 2: .*HTTP 429/);
  });

  it("fails if the script ends without writing any data", async () => {
    exists.mockReturnValue(false);
    const child = fakeChild();
    const p = fetchWithPython();
    child.emit("close", 0);
    await expect(p).rejects.toThrow(/wrote no data/);
  });

  it("stops a fetch that runs too long", async () => {
    jest.useFakeTimers();
    const child = fakeChild();
    const p = fetchWithPython({ timeoutMs: 5000 });
    const assertion = expect(p).rejects.toThrow(/longer than 5s/);
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(child.kill).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
