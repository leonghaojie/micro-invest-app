/**
 * PeerCohortService (DECISIONS.md #18): how stored plans and profiles become engine
 * members, the "not ready" states, and that nothing identifying leaves the server.
 * Prisma, the plan service and the data-currency lookup are mocked.
 */
import { prisma } from "../config/prisma";
import { peerCohortService } from "./peerCohort.service";
import { planService } from "./plan.service";
import { oldestLatestMonth } from "./fundDataUpdate.service";
import { trailingMonths } from "../utils/peerCohort";

jest.mock("../config/prisma", () => ({
  prisma: {
    userProfile: { findUnique: jest.fn() },
    plan: { findMany: jest.fn() },
    fundMonthlyReturn: { findMany: jest.fn() },
    ledgerEntry: { groupBy: jest.fn() },
  },
}));
jest.mock("./plan.service", () => ({ planService: { getActivePlan: jest.fn() } }));
jest.mock("./fundDataUpdate.service", () => ({ oldestLatestMonth: jest.fn() }));

const db = prisma as unknown as {
  userProfile: { findUnique: jest.Mock };
  plan: { findMany: jest.Mock };
  fundMonthlyReturn: { findMany: jest.Mock };
  ledgerEntry: { groupBy: jest.Mock };
};
const plans = planService as unknown as { getActivePlan: jest.Mock };
const latest = oldestLatestMonth as unknown as jest.Mock;

const ASOF = "2026-09";
const MONTHS = trailingMonths(ASOF, 12);
const date = (m: string) => new Date(`${m}-01T00:00:00.000Z`);

function planRow(i: number, over: { userId?: string; synthetic?: boolean; noProfile?: boolean; risk?: string; months?: number; holdingless?: boolean; positionless?: boolean } = {}) {
  const userId = over.userId ?? `user-${i}`;
  const n = over.months ?? 12;
  return {
    id: `plan-${userId}`,
    userId,
    contributionAmount: String(200 + (i % 10) * 40),
    user: {
      isSynthetic: over.synthetic ?? true,
      profile: over.noProfile
        ? null
        : {
            age: 22 + (i % 15),
            monthlyIncome: String(2500 + i * 60),
            monthlyExpense: String(1500 + i * 25),
            riskLevel: over.risk ?? (["LOW", "MEDIUM", "HIGH"][i % 3] as string),
            experienceLevel: (["BEGINNER", "INTERMEDIATE", "EXPERIENCED"] as const)[i % 3], // stored, but not used for matching
          },
    },
    holdings: over.holdingless
      ? []
      : [
          { value: "600.00", fund: { assetClass: i % 2 ? "EQUITY" : "BOND", ticker: i % 2 ? "VT" : "AGG", name: i % 2 ? "World stocks" : "US bonds" } },
          { value: "400.00", fund: { assetClass: "REIT", ticker: "VNQ", name: "Real estate" } },
        ],
    // newest first, as the query returns them
    months: MONTHS.slice(-n)
      .reverse()
      .map((m, k) => ({ monthDate: date(m), endingBalance: String(5000 + i * 10 - k * 20), portfolioReturnPct: String(0.004 + ((i + k) % 7) * 0.002), hasPosition: !over.positionless })),
  };
}

/** One row per plan per month, as the groupBy returns them. */
const buyRowsFor = (n: number, months = MONTHS.slice(-6), missing: (i: number, m: string) => boolean = () => false) =>
  Array.from({ length: n }, (_, i) => months.filter((m) => !missing(i, m)).map((m) => ({ planId: `plan-user-${i}`, month: date(m) }))).flat();

const crowd = (n: number) => Array.from({ length: n }, (_, i) => planRow(i));

beforeEach(() => {
  jest.resetAllMocks();
  db.userProfile.findUnique.mockResolvedValue({ userId: "user-0" });
  plans.getActivePlan.mockResolvedValue({ planId: "p" });
  latest.mockResolvedValue(ASOF);
  db.plan.findMany.mockResolvedValue(crowd(120));
  // everyone bought in each of the last six months
  db.ledgerEntry.groupBy.mockImplementation(() => Promise.resolve(buyRowsFor(120)));
  db.fundMonthlyReturn.findMany.mockResolvedValue([
    ...MONTHS.map((m) => ({ monthDate: date(m), returnPct: "0.010000", fund: { ticker: "VT" } })),
    ...MONTHS.map((m) => ({ monthDate: date(m), returnPct: "0.003000", fund: { ticker: "AGG" } })),
  ]);
});

describe("PeerCohortService.getCohort", () => {
  it("is 'no-profile' for a user who has not set up a profile (and does no other work)", async () => {
    db.userProfile.findUnique.mockResolvedValue(null);
    expect(await peerCohortService.getCohort("user-0")).toEqual({ status: "no-profile" });
    expect(plans.getActivePlan).not.toHaveBeenCalled();
    expect(db.plan.findMany).not.toHaveBeenCalled();
  });

  it("is 'no-plan' for a user with a profile but no plan", async () => {
    plans.getActivePlan.mockResolvedValue(null);
    expect(await peerCohortService.getCohort("user-0")).toEqual({ status: "no-plan" });
    expect(db.plan.findMany).not.toHaveBeenCalled();
  });

  it("is 'no-data' when there is no fund data yet", async () => {
    latest.mockResolvedValue(null);
    expect(await peerCohortService.getCohort("user-0")).toEqual({ status: "no-data" });
  });

  it("recomputes the user's own plan before reading anyone's, so their figures are current", async () => {
    await peerCohortService.getCohort("user-0");
    expect(plans.getActivePlan).toHaveBeenCalledWith("user-0");
    expect(plans.getActivePlan.mock.invocationCallOrder[0]).toBeLessThan(db.plan.findMany.mock.invocationCallOrder[0]);
  });

  it("returns a full report: identity, group, a headline with a benchmark, and six cards", async () => {
    const res = await peerCohortService.getCohort("user-0");

    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.asOf).toBe(ASOF);
    expect(res.report.suppressed).toBe(false);
    expect(res.report.identity).toHaveLength(4);
    expect(res.report.group!.size).toBeGreaterThan(0);
    expect(res.report.cards.map((c) => c.key)).toEqual(["value", "return", "monthlyReturn", "investmentRate", "consistency", "diversification"]);
    expect(res.report.headline).toMatchObject({ windowMonths: 12 });
    expect(res.report.headline!.benchmark).not.toBeNull();
  });

  it("takes the value at the latest month on record (as Explore does) and the latest month's return", async () => {
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.report.cards.find((c) => c.key === "value")!.you).toBe(5000);
    expect(res.report.cards.find((c) => c.key === "monthlyReturn")!.you).toBe(0.4);
  });

  it("works out contribution consistency from the months each account bought in", async () => {
    // user-0 missed two of the last six months; everyone else bought in all six
    db.ledgerEntry.groupBy.mockResolvedValue(buyRowsFor(120, MONTHS.slice(-6), (i, m) => i === 0 && (m === MONTHS[7] || m === MONTHS[9])));
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    const card = res.report.cards.find((c) => c.key === "consistency")!;
    expect(card.status).toBe("ok");
    expect(card.you).toBeLessThan(100);
    expect(card.median).toBe(100);
  });

  it("a user with fewer than 3 months of buying has no consistency figure yet", async () => {
    db.ledgerEntry.groupBy.mockResolvedValue(buyRowsFor(120, MONTHS.slice(-2)));
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.report.cards.find((c) => c.key === "consistency")!.status).toBe("unavailable");
  });

  it("says what the peers hold: their mix, the most-held funds and how many funds they hold", async () => {
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    const h = res.report.holdings!;
    expect(h.peerCount).toBeGreaterThan(0);
    expect(h.topFunds.map((f) => f.ticker)).toContain("VNQ"); // every fixture portfolio holds it
    expect(h.topFunds.find((f) => f.ticker === "VNQ")).toMatchObject({ name: "Real estate", heldByPct: 100, youHold: true });
    expect(h.avgFunds).toBe(2);
    expect(h.peerMix.find((x) => x.assetClass === "REIT")!.pct).toBe(40);
  });

  it("reports how much of the population is simulated", async () => {
    db.plan.findMany.mockResolvedValue([...crowd(90), ...Array.from({ length: 30 }, (_, i) => planRow(200 + i, { synthetic: false }))]);
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.population).toEqual({ size: 120, simulatedPct: 75 });
  });

  it("reads at most 12 months per plan, newest first, and only the funds the benchmark uses", async () => {
    await peerCohortService.getCohort("user-0");
    expect(db.plan.findMany.mock.calls[0][0].include.months).toEqual({ orderBy: { monthDate: "desc" }, take: 12 });
    const where = db.fundMonthlyReturn.findMany.mock.calls[0][0].where;
    expect(where.fund.ticker.in.sort()).toEqual(["AGG", "VT"]);
    expect(where.monthDate.gte).toEqual(date(MONTHS[0]));
  });

  it("compares only people who have invested: an account holding just cash is left out", async () => {
    db.plan.findMany.mockResolvedValue([...crowd(100), planRow(500, { holdingless: true, positionless: true })]);
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.population.size).toBe(100);
  });

  it("is 'no-plan' for a user who has an account but has never invested", async () => {
    db.plan.findMany.mockResolvedValue([planRow(0, { holdingless: true, positionless: true }), ...crowd(100).slice(1)]);
    expect(await peerCohortService.getCohort("user-0")).toEqual({ status: "no-plan" });
  });

  it("leaves months with nothing invested out of a person's returns", async () => {
    const own = planRow(0);
    own.months[0] = { ...own.months[0], hasPosition: false }; // the newest month had no position
    db.plan.findMany.mockResolvedValue([own, ...crowd(100).slice(1)]);
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    // the window can no longer reach the latest month, so the headline is unavailable
    expect(res.report.headline).toBeNull();
  });

  it("skips plans whose owner has no profile", async () => {
    db.plan.findMany.mockResolvedValue([...crowd(100), planRow(500, { noProfile: true })]);
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.population.size).toBe(100);
  });

  it("is 'no-plan' if the user's own plan row is somehow not among the plans read", async () => {
    db.plan.findMany.mockResolvedValue(crowd(100).slice(1)); // user-0 missing
    expect(await peerCohortService.getCohort("user-0")).toEqual({ status: "no-plan" });
  });

  it("withholds everything when the population is below the privacy floor", async () => {
    db.plan.findMany.mockResolvedValue(crowd(6));
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.report.suppressed).toBe(true);
    expect(res.report.cards).toEqual([]);
  });

  it("a plan with fewer months than the window still counts for non-return metrics", async () => {
    db.plan.findMany.mockResolvedValue([...crowd(100).slice(0, 99), planRow(99, { months: 2 })]);
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.population.size).toBe(100);
  });

  it("never returns an id, an email, or any individual's record", async () => {
    const res = await peerCohortService.getCohort("user-0");
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/user-\d+/);
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/"(id|userId|email)"/);
  });

  it("returns a benchmark of null rather than a wrong number when the fund data has a gap", async () => {
    db.fundMonthlyReturn.findMany.mockResolvedValue([{ monthDate: date(MONTHS[11]), returnPct: "0.01", fund: { ticker: "VT" } }]);
    const res = await peerCohortService.getCohort("user-0");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.report.headline!.benchmark).toBeNull();
  });
});
