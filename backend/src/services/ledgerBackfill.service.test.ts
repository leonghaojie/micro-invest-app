/**
 * Backfill of the old fixed plans into the ledger (DECISIONS.md #19): what gets written for a
 * legacy plan, the options the seed uses for irregular synthetic peers, and that nothing is done
 * twice. Prisma and the ledger service are mocked.
 */
import { prisma } from "../config/prisma";
import { getClock, refreshAccount } from "./ledger.service";
import { backfillLegacyPlans } from "./ledgerBackfill.service";

const tx = {
  plan: { findUnique: jest.fn(), update: jest.fn() },
  cashCredit: { createMany: jest.fn() },
  ledgerEntry: { createMany: jest.fn() },
  recurringRule: { create: jest.fn() },
};

jest.mock("../config/prisma", () => ({ prisma: { plan: { findMany: jest.fn() }, $transaction: jest.fn() } }));
jest.mock("./ledger.service", () => ({
  getClock: jest.fn(),
  refreshAccount: jest.fn(),
  monthDate: (m: string) => new Date(`${m}-01T00:00:00.000Z`),
  monthKey: (d: Date) => d.toISOString().slice(0, 7),
}));

const db = prisma as unknown as { plan: { findMany: jest.Mock }; $transaction: jest.Mock };
const clock = getClock as unknown as jest.Mock;
const refresh = refreshAccount as unknown as jest.Mock;

const legacyPlan = (over: object = {}) => ({
  id: "plan-1",
  userId: "user-1",
  portfolioId: "pf-1",
  contributionAmount: "100.00",
  startMonth: new Date("2026-07-01T00:00:00.000Z"),
  portfolio: { allocations: [{ fundId: "fa", weightPct: "60.00" }, { fundId: "fb", weightPct: "40.00" }] },
  user: { profile: { monthlyIncome: "4000.00", monthlyExpense: "2400.00" } },
  ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  clock.mockResolvedValue({ latestDataMonth: "2026-09", tradeMonth: "2026-10" });
  db.plan.findMany.mockResolvedValue([{ id: "plan-1", userId: "user-1" }]);
  db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  tx.plan.findUnique.mockResolvedValue(legacyPlan());
  refresh.mockResolvedValue({});
});

const entryMonths = () => tx.ledgerEntry.createMany.mock.calls[0][0].data.map((e: { month: Date }) => e.month.toISOString().slice(0, 7));

describe("backfillLegacyPlans", () => {
  it("does nothing when no plan is in the old form (idempotent)", async () => {
    db.plan.findMany.mockResolvedValue([]);
    expect(await backfillLegacyPlans()).toEqual({ migrated: 0, skipped: 0 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("writes a credit and a buy per fund for every month from the start to the latest data, then a recurring buy", async () => {
    expect(await backfillLegacyPlans()).toEqual({ migrated: 1, skipped: 0 });

    const credits = tx.cashCredit.createMany.mock.calls[0][0].data;
    expect(credits.map((c: { month: Date }) => c.month.toISOString().slice(0, 7))).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(credits.every((c: { amount: number; source: string }) => c.amount === 1600 && c.source === "MIGRATED")).toBe(true);

    const entries = tx.ledgerEntry.createMany.mock.calls[0][0].data;
    expect(entries).toHaveLength(6); // 3 months x 2 funds
    expect(entries.filter((e: { month: Date }) => e.month.toISOString().startsWith("2026-07")).map((e: { fundId: string; amount: number }) => [e.fundId, e.amount])).toEqual([["fa", 60], ["fb", 40]]);

    expect(tx.recurringRule.create).toHaveBeenCalledWith({ data: { planId: "plan-1", portfolioId: "pf-1", amount: 100, startMonth: new Date("2026-10-01T00:00:00.000Z") } });
    expect(tx.plan.update).toHaveBeenCalledWith({ where: { id: "plan-1" }, data: { portfolioId: null } });
    expect(refresh).toHaveBeenCalledWith("user-1");
  });

  it("with a 'buys' option, leaves out the months it says the account did not buy in (credits stay)", async () => {
    await backfillLegacyPlans({ buys: (_u, month) => month !== "2026-08" });
    expect(new Set(entryMonths())).toEqual(new Set(["2026-07", "2026-09"]));
    expect(tx.cashCredit.createMany.mock.calls[0][0].data).toHaveLength(3); // cash is credited every month regardless
  });

  it("passes the user id to 'buys', so the seed can decide per peer", async () => {
    const buys = jest.fn().mockReturnValue(true);
    await backfillLegacyPlans({ buys });
    expect(buys).toHaveBeenCalledWith("user-1", "2026-07");
  });

  it("with 'recurring' off, the account keeps no monthly buy going forward", async () => {
    await backfillLegacyPlans({ recurring: () => false });
    expect(tx.recurringRule.create).not.toHaveBeenCalled();
    expect(tx.plan.update).toHaveBeenCalled(); // still marked as migrated
  });

  it("starts no recurring buy for a plan that contributed nothing", async () => {
    tx.plan.findUnique.mockResolvedValue(legacyPlan({ contributionAmount: "0.00" }));
    await backfillLegacyPlans();
    expect(tx.recurringRule.create).not.toHaveBeenCalled();
  });

  it("skips a plan that has no portfolio or no profile", async () => {
    tx.plan.findUnique.mockResolvedValue(legacyPlan({ portfolioId: null }));
    expect(await backfillLegacyPlans()).toEqual({ migrated: 0, skipped: 1 });
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it("writes no history for a plan that starts after the latest data, but still migrates it", async () => {
    tx.plan.findUnique.mockResolvedValue(legacyPlan({ startMonth: new Date("2026-11-01T00:00:00.000Z") }));
    await backfillLegacyPlans();
    expect(tx.cashCredit.createMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(tx.plan.update).toHaveBeenCalled();
  });

  it("a failure deriving one account does not stop the rest", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    refresh.mockRejectedValue(new Error("boom"));
    await expect(backfillLegacyPlans()).resolves.toEqual({ migrated: 1, skipped: 0 });
    spy.mockRestore();
  });
});
