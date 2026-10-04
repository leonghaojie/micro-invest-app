/**
 * FundDataUpdateService (DECISIONS.md #15): when an update is needed, what gets
 * written, and what happens around it. Prisma, the plan service and the file
 * system are mocked; nothing here touches the network or a database.
 */
import { readFileSync } from "fs";
import { prisma } from "../config/prisma";
import { loadFundDataFromDir, oldestLatestMonth, refreshAllPlans, runFundDataUpdate } from "./fundDataUpdate.service";
import { planService } from "./plan.service";

jest.mock("fs", () => ({ ...jest.requireActual("fs"), readFileSync: jest.fn() }));
jest.mock("../config/prisma", () => ({
  prisma: {
    fund: { findMany: jest.fn(), upsert: jest.fn() },
    fundMonthlyReturn: { findMany: jest.fn(), createMany: jest.fn(), update: jest.fn() },
    plan: { findMany: jest.fn() },
  },
}));
jest.mock("./plan.service", () => ({ planService: { getActivePlan: jest.fn() } }));

const db = prisma as unknown as {
  fund: { findMany: jest.Mock; upsert: jest.Mock };
  fundMonthlyReturn: { findMany: jest.Mock; createMany: jest.Mock; update: jest.Mock };
  plan: { findMany: jest.Mock };
};
const plans = planService as unknown as { getActivePlan: jest.Mock };
const readFile = readFileSync as unknown as jest.Mock;

const NOW = new Date("2026-10-04T12:00:00Z"); // latest complete month: 2026-09
const month = (m: string) => new Date(`${m}-01T00:00:00.000Z`);
const fundWithLatest = (m: string | null) => ({ monthlyReturns: m ? [{ monthDate: month(m) }] : [] });

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("oldestLatestMonth", () => {
  it("is the month the laggard fund has data to", async () => {
    db.fund.findMany.mockResolvedValue([fundWithLatest("2026-09"), fundWithLatest("2026-07"), fundWithLatest("2026-08")]);
    expect(await oldestLatestMonth()).toBe("2026-07");
  });

  it("is null with no funds, or when any fund has no data at all", async () => {
    db.fund.findMany.mockResolvedValue([]);
    expect(await oldestLatestMonth()).toBeNull();
    db.fund.findMany.mockResolvedValue([fundWithLatest("2026-09"), fundWithLatest(null)]);
    expect(await oldestLatestMonth()).toBeNull();
  });
});

describe("runFundDataUpdate", () => {
  const fetchRaw = jest.fn();

  beforeEach(() => {
    fetchRaw.mockReset().mockResolvedValue("/data");
    db.plan.findMany.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
    plans.getActivePlan.mockResolvedValue({});
    // Raw data: one fund whose September is new.
    readFile.mockImplementation((path: string) =>
      String(path).endsWith("_manifest.json")
        ? JSON.stringify(["ES3.SI"])
        : JSON.stringify({
            symbol: "ES3.SI",
            exchange: "SGX",
            name: "SPDR STI",
            assetClass: "EQUITY",
            currency: "SGD",
            rows: [
              { date: "2026-07-01", close: 100, dividends: 0 },
              { date: "2026-08-01", close: 101, dividends: 0 },
              { date: "2026-09-01", close: 102, dividends: 0 },
            ],
          })
    );
    db.fund.upsert.mockResolvedValue({ id: "f1" });
    db.fundMonthlyReturn.createMany.mockResolvedValue({ count: 1 });
  });

  it("does nothing - no fetch, no writes - when no completed month is missing", async () => {
    db.fund.findMany.mockResolvedValue([fundWithLatest("2026-09"), fundWithLatest("2026-09")]);

    const summary = await runFundDataUpdate({ fetchRaw, now: NOW });

    expect(summary).toMatchObject({ status: "up-to-date", expectedMonth: "2026-09", latestBefore: "2026-09", latestAfter: "2026-09" });
    expect(fetchRaw).not.toHaveBeenCalled();
    expect(db.fund.upsert).not.toHaveBeenCalled();
    expect(plans.getActivePlan).not.toHaveBeenCalled();
  });

  it("fetches, loads and refreshes every plan when months are missing (today: data ends July, October has begun)", async () => {
    db.fund.findMany
      .mockResolvedValueOnce([fundWithLatest("2026-07")]) // before
      .mockResolvedValueOnce([fundWithLatest("2026-09")]); // after
    db.fundMonthlyReturn.findMany
      .mockResolvedValueOnce([{ id: "r1", monthDate: month("2026-08"), startPrice: "100", endPrice: "101", dividendAmount: "0", returnPct: "0.01" }])
      .mockResolvedValueOnce([{ monthDate: month("2026-07") }, { monthDate: month("2026-08") }, { monthDate: month("2026-09") }]);

    const summary = await runFundDataUpdate({ fetchRaw, now: NOW });

    expect(fetchRaw).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ status: "updated", latestBefore: "2026-07", latestAfter: "2026-09", plansRefreshed: 2 });
    expect(summary.load).toMatchObject({ funds: 1, newMonths: 1, revisedMonths: 0, rejected: 0 });
    expect(plans.getActivePlan).toHaveBeenCalledTimes(2);
  });

  it("reports no-new-data (and refreshes nothing) when the fetch brings nothing the database lacks", async () => {
    db.fund.findMany.mockResolvedValue([fundWithLatest("2026-08")]);
    // both derived months already stored, identical
    db.fundMonthlyReturn.findMany
      .mockResolvedValueOnce([
        { id: "r1", monthDate: month("2026-08"), startPrice: "100", endPrice: "101", dividendAmount: "0", returnPct: "0.010000" },
        { id: "r2", monthDate: month("2026-09"), startPrice: "101", endPrice: "102", dividendAmount: "0", returnPct: ((102 - 101) / 101).toFixed(6) },
      ])
      .mockResolvedValueOnce([{ monthDate: month("2026-08") }, { monthDate: month("2026-09") }]);

    const summary = await runFundDataUpdate({ fetchRaw, now: NOW });

    expect(summary.status).toBe("no-new-data");
    expect(db.fundMonthlyReturn.createMany).not.toHaveBeenCalled();
    expect(plans.getActivePlan).not.toHaveBeenCalled();
  });

  it("fetches even when up to date if forced", async () => {
    db.fund.findMany.mockResolvedValue([fundWithLatest("2026-09")]);
    db.fundMonthlyReturn.findMany.mockResolvedValue([]);

    await runFundDataUpdate({ fetchRaw, now: NOW, force: true });

    expect(fetchRaw).toHaveBeenCalledTimes(1);
  });

  it("fetches when there is no fund data yet", async () => {
    db.fund.findMany.mockResolvedValue([]);
    db.fundMonthlyReturn.findMany.mockResolvedValue([]);

    const summary = await runFundDataUpdate({ fetchRaw, now: NOW });

    expect(summary.latestBefore).toBeNull();
    expect(fetchRaw).toHaveBeenCalledTimes(1);
  });

  it("never throws: a failed fetch becomes a 'failed' summary, and nothing is written", async () => {
    db.fund.findMany.mockResolvedValue([fundWithLatest("2026-07")]);
    fetchRaw.mockRejectedValue(new Error("Python was not found"));

    const summary = await runFundDataUpdate({ fetchRaw, now: NOW });

    expect(summary).toMatchObject({ status: "failed", error: "Python was not found" });
    expect(db.fund.upsert).not.toHaveBeenCalled();
    expect(plans.getActivePlan).not.toHaveBeenCalled();
  });

  it("lets only one run go at a time", async () => {
    db.fund.findMany.mockResolvedValue([fundWithLatest("2026-07")]);
    db.fundMonthlyReturn.findMany.mockResolvedValue([]);
    let release: () => void = () => undefined;
    fetchRaw.mockReturnValue(new Promise<string>((resolve) => (release = () => resolve("/data"))));

    const first = runFundDataUpdate({ fetchRaw, now: NOW });
    await new Promise((r) => setImmediate(r));
    const second = await runFundDataUpdate({ fetchRaw, now: NOW });
    expect(second.status).toBe("already-running");

    release();
    await first;
    // and the lock is released afterwards
    fetchRaw.mockResolvedValue("/data");
    expect((await runFundDataUpdate({ fetchRaw, now: NOW })).status).not.toBe("already-running");
  });
});

describe("loadFundDataFromDir", () => {
  const raw = (rows: { date: string; close: number; dividends?: number }[]) => {
    readFile.mockImplementation((path: string) =>
      String(path).endsWith("_manifest.json")
        ? JSON.stringify(["ES3.SI"])
        : JSON.stringify({ symbol: "ES3.SI", exchange: "SGX", name: "SPDR STI", assetClass: "EQUITY", currency: "SGD", rows: rows.map((r) => ({ dividends: 0, ...r })) })
    );
  };

  beforeEach(() => {
    db.fund.upsert.mockResolvedValue({ id: "f1" });
    db.fundMonthlyReturn.createMany.mockResolvedValue({ count: 0 });
  });

  it("inserts new months, leaves identical ones alone, and corrects ones whose values changed", async () => {
    raw([
      { date: "2026-06-01", close: 100 },
      { date: "2026-07-01", close: 101 },
      { date: "2026-08-01", close: 102 },
      { date: "2026-09-01", close: 103, dividends: 0.5 },
      { date: "2026-10-01", close: 104 }, // unfinished month: ignored
    ]);
    db.fundMonthlyReturn.findMany
      .mockResolvedValueOnce([
        { id: "r-jul", monthDate: month("2026-07"), startPrice: "100.0000", endPrice: "101.0000", dividendAmount: "0.0000", returnPct: "0.010000" }, // identical
        { id: "r-aug", monthDate: month("2026-08"), startPrice: "101.0000", endPrice: "99.0000", dividendAmount: "0.0000", returnPct: "-0.019802" }, // stale
      ])
      .mockResolvedValueOnce([{ monthDate: month("2026-07") }, { monthDate: month("2026-08") }, { monthDate: month("2026-09") }]);

    const result = await loadFundDataFromDir("/data", NOW);

    expect(result).toMatchObject({ funds: 1, newMonths: 1, revisedMonths: 1, rejected: 0, gaps: [] });
    // new: September, with its dividend and a total return that includes it
    const created = db.fundMonthlyReturn.createMany.mock.calls[0][0];
    expect(created.skipDuplicates).toBe(true);
    expect(created.data).toHaveLength(1);
    expect(created.data[0]).toMatchObject({ fundId: "f1", startPrice: "102.0000", endPrice: "103.0000", dividendAmount: "0.5000" });
    expect(created.data[0].monthDate.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(created.data[0].returnPct).toBe(((103 + 0.5 - 102) / 102).toFixed(6));
    // revised: only August
    expect(db.fundMonthlyReturn.update).toHaveBeenCalledTimes(1);
    expect(db.fundMonthlyReturn.update.mock.calls[0][0]).toMatchObject({ where: { id: "r-aug" }, data: { endPrice: "102.0000" } });
  });

  it("does not treat a rounding difference as a revision (S&P 500 prices like 44.40625 are stored as 44.4063)", async () => {
    raw([
      { date: "1993-02-01", close: 44.40625 },
      { date: "1993-03-01", close: 45.1875 },
    ]);
    // exactly what a previous load stored: prices to 4 dp, return to 6 dp
    db.fundMonthlyReturn.findMany
      .mockResolvedValueOnce([
        {
          id: "r-mar",
          monthDate: month("1993-03"),
          startPrice: (44.40625).toFixed(4),
          endPrice: (45.1875).toFixed(4),
          dividendAmount: "0.0000",
          returnPct: ((45.1875 - 44.40625) / 44.40625).toFixed(6),
        },
      ])
      .mockResolvedValueOnce([{ monthDate: month("1993-03") }]);

    const result = await loadFundDataFromDir("/data", NOW);

    expect(result.revisedMonths).toBe(0);
    expect(result.newMonths).toBe(0);
    expect(db.fundMonthlyReturn.update).not.toHaveBeenCalled();
  });

  it("still catches a change of one unit in the last stored digit", async () => {
    raw([
      { date: "2026-08-01", close: 100 },
      { date: "2026-09-01", close: 101.0001 },
    ]);
    db.fundMonthlyReturn.findMany
      .mockResolvedValueOnce([
        { id: "r", monthDate: month("2026-09"), startPrice: "100.0000", endPrice: "101.0000", dividendAmount: "0.0000", returnPct: ((101 - 100) / 100).toFixed(6) },
      ])
      .mockResolvedValueOnce([{ monthDate: month("2026-09") }]);

    expect((await loadFundDataFromDir("/data", NOW)).revisedMonths).toBe(1);
  });

  it("rejects an implausible month rather than storing it", async () => {
    raw([
      { date: "2026-07-01", close: 100 },
      { date: "2026-08-01", close: 10 }, // -90% in a month: a glitch
      { date: "2026-09-01", close: 11 },
    ]);
    db.fundMonthlyReturn.findMany.mockResolvedValue([]);

    const result = await loadFundDataFromDir("/data", NOW);

    expect(result.rejected).toBe(1);
    expect(result.newMonths).toBe(1); // only September survives
    expect(db.fundMonthlyReturn.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it("reports a hole in a fund's history instead of hiding it", async () => {
    raw([
      { date: "2026-07-01", close: 100 },
      { date: "2026-08-01", close: 101 },
    ]);
    db.fundMonthlyReturn.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ monthDate: month("2026-05") }, { monthDate: month("2026-08") }]);

    const result = await loadFundDataFromDir("/data", NOW);

    expect(result.gaps).toEqual([{ ticker: "ES3.SI", months: ["2026-06", "2026-07"] }]);
  });

  it("does not call createMany when there is nothing new", async () => {
    raw([
      { date: "2026-08-01", close: 100 },
      { date: "2026-09-01", close: 101 },
    ]);
    db.fundMonthlyReturn.findMany
      .mockResolvedValueOnce([{ id: "r", monthDate: month("2026-09"), startPrice: "100", endPrice: "101", dividendAmount: "0", returnPct: "0.010000" }])
      .mockResolvedValueOnce([{ monthDate: month("2026-09") }]);

    await loadFundDataFromDir("/data", NOW);

    expect(db.fundMonthlyReturn.createMany).not.toHaveBeenCalled();
  });
});

describe("refreshAllPlans", () => {
  it("recomputes every plan and counts them", async () => {
    db.plan.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ userId: `u${i}` })));
    plans.getActivePlan.mockResolvedValue({});

    expect(await refreshAllPlans(8)).toBe(20);
    expect(plans.getActivePlan).toHaveBeenCalledTimes(20);
  });

  it("keeps going when one plan cannot be refreshed", async () => {
    db.plan.findMany.mockResolvedValue([{ userId: "a" }, { userId: "b" }, { userId: "c" }]);
    plans.getActivePlan.mockImplementation((id: string) => (id === "b" ? Promise.reject(new Error("boom")) : Promise.resolve({})));

    expect(await refreshAllPlans()).toBe(2);
  });

  it("works with no plans", async () => {
    db.plan.findMany.mockResolvedValue([]);
    expect(await refreshAllPlans()).toBe(0);
  });
});
