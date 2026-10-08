/**
 * LedgerService (DECISIONS.md #19): clock, opening an account, catching up (monthly credits and
 * due recurring buys) and storing the derived rows. The arithmetic itself is tested in
 * utils/ledger.test.ts; Prisma is mocked here.
 */
import { prisma } from "../config/prisma";
import { advance, ensureAccount, getClock, persistDerived, refreshAccount, runDueRules } from "./ledger.service";
import { oldestLatestMonth } from "./fundClock";

jest.mock("../config/prisma", () => ({ prisma: { userProfile: { findUnique: jest.fn() }, plan: { findUnique: jest.fn() }, $transaction: jest.fn() } }));
jest.mock("./fundClock", () => ({ oldestLatestMonth: jest.fn() }));

const latest = oldestLatestMonth as unknown as jest.Mock;
const db = prisma as unknown as { userProfile: { findUnique: jest.Mock }; plan: { findUnique: jest.Mock }; $transaction: jest.Mock };
const CLOCK = { latestDataMonth: "2026-09", tradeMonth: "2026-10" };
const d = (m: string) => new Date(`${m}-01T00:00:00.000Z`);

function makeTx() {
  return {
    plan: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    userProfile: { findUnique: jest.fn() },
    cashCredit: { findMany: jest.fn(), createMany: jest.fn(), create: jest.fn(), aggregate: jest.fn() },
    ledgerEntry: { createMany: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
    recurringRule: { findMany: jest.fn() },
    recurringRun: { create: jest.fn() },
    planMonth: { upsert: jest.fn() },
    planHolding: { deleteMany: jest.fn(), createMany: jest.fn() },
    fundMonthlyReturn: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
}
type Tx = ReturnType<typeof makeTx>;
const asTx = (t: Tx) => t as unknown as Parameters<typeof advance>[0];

const profile = { userId: "u", monthlyIncome: "4000.00", monthlyExpense: "2400.00" };
/** Every credit written, in order, across the one-month-at-a-time createMany calls. */
const credited = (tx: Tx): { month: Date; amount: number; source: string }[] => tx.cashCredit.createMany.mock.calls.flatMap((c) => c[0].data);

beforeEach(() => jest.resetAllMocks());

describe("getClock", () => {
  it("the trade month is the month after the latest data", async () => {
    latest.mockResolvedValue("2026-09");
    expect(await getClock()).toEqual(CLOCK);
    latest.mockResolvedValue("2026-12");
    expect(await getClock()).toEqual({ latestDataMonth: "2026-12", tradeMonth: "2027-01" });
  });

  it("is a 503 when there is no fund data at all", async () => {
    latest.mockResolvedValue(null);
    await expect(getClock()).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("ensureAccount", () => {
  it("returns an existing account without changing anything", async () => {
    const tx = makeTx();
    tx.plan.findUnique.mockResolvedValue({ id: "plan-1" });
    expect(await ensureAccount(asTx(tx), "u", CLOCK)).toEqual({ id: "plan-1" });
    expect(tx.plan.create).not.toHaveBeenCalled();
    expect(tx.cashCredit.create).not.toHaveBeenCalled();
  });

  it("opens an account with the setup's spare income credited as this month's cash", async () => {
    const tx = makeTx();
    tx.plan.findUnique.mockResolvedValue(null);
    tx.userProfile.findUnique.mockResolvedValue(profile);
    tx.plan.create.mockResolvedValue({ id: "plan-new" });

    await ensureAccount(asTx(tx), "u", CLOCK);

    expect(tx.plan.create).toHaveBeenCalledWith({ data: { userId: "u", startMonth: d("2026-10"), contributionAmount: 0 } });
    expect(tx.cashCredit.create).toHaveBeenCalledWith({ data: { planId: "plan-new", month: d("2026-10"), amount: 1600, source: "SETUP" } });
  });

  it("opens at zero, not in debt, when the setup's expenses exceed its income (there is no cash to pay the gap)", async () => {
    const tx = makeTx();
    tx.plan.findUnique.mockResolvedValue(null);
    tx.userProfile.findUnique.mockResolvedValue({ ...profile, monthlyExpense: "5000.00" });
    tx.plan.create.mockResolvedValue({ id: "p" });
    await ensureAccount(asTx(tx), "u", CLOCK);
    expect(tx.cashCredit.create.mock.calls[0][0].data.amount).toBe(0);
  });

  it("needs a profile", async () => {
    const tx = makeTx();
    tx.plan.findUnique.mockResolvedValue(null);
    tx.userProfile.findUnique.mockResolvedValue(null);
    await expect(ensureAccount(asTx(tx), "u", CLOCK)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("advance (catching up)", () => {
  it("credits every month missing one, from the first credit to the trade month", async () => {
    const tx = makeTx();
    tx.userProfile.findUnique.mockResolvedValue(profile);
    tx.cashCredit.findMany.mockResolvedValue([{ month: d("2026-07") }, { month: d("2026-08") }]);
    tx.recurringRule.findMany.mockResolvedValue([]);

    await advance(asTx(tx), "plan-1", "u", CLOCK);

    const data = credited(tx);
    expect(data.map((c) => c.month.toISOString().slice(0, 7))).toEqual(["2026-09", "2026-10"]);
    expect(data.every((c) => c.amount === 1600 && c.source === "MONTHLY")).toBe(true);
    expect(tx.cashCredit.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("fills a gap in the middle, not just the end", async () => {
    const tx = makeTx();
    tx.userProfile.findUnique.mockResolvedValue(profile);
    tx.cashCredit.findMany.mockResolvedValue([{ month: d("2026-07") }, { month: d("2026-10") }]);
    tx.recurringRule.findMany.mockResolvedValue([]);
    await advance(asTx(tx), "plan-1", "u", CLOCK);
    expect(credited(tx).map((c) => c.month.toISOString().slice(0, 7))).toEqual(["2026-08", "2026-09"]);
  });

  describe("a month that spends more than it earns (DECISIONS.md #31)", () => {
    const overspend = { ...profile, monthlyExpense: "4500.00" }; // spare -500

    it("is paid from the cash the account has", async () => {
      const tx = makeTx();
      tx.userProfile.findUnique.mockResolvedValue(overspend);
      tx.cashCredit.findMany.mockResolvedValue([{ month: d("2026-09") }]);
      tx.recurringRule.findMany.mockResolvedValue([]);
      tx.cashCredit.aggregate.mockResolvedValue({ _sum: { amount: 2000 } });
      tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      await advance(asTx(tx), "plan-1", "u", CLOCK);

      expect(credited(tx)).toEqual([{ planId: "plan-1", month: d("2026-10"), amount: -500, source: "MONTHLY" }]);
    });

    it("is limited to the cash there is, so the account never goes into debt", async () => {
      const tx = makeTx();
      tx.userProfile.findUnique.mockResolvedValue(overspend);
      tx.cashCredit.findMany.mockResolvedValue([{ month: d("2026-09") }]);
      tx.recurringRule.findMany.mockResolvedValue([]);
      tx.cashCredit.aggregate.mockResolvedValue({ _sum: { amount: 120.5 } });
      tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      await advance(asTx(tx), "plan-1", "u", CLOCK);

      expect(credited(tx)[0].amount).toBe(-120.5);
    });

    it("a surplus month does not look at the cash at all", async () => {
      const tx = makeTx();
      tx.userProfile.findUnique.mockResolvedValue(profile);
      tx.cashCredit.findMany.mockResolvedValue([{ month: d("2026-09") }]);
      tx.recurringRule.findMany.mockResolvedValue([]);
      await advance(asTx(tx), "plan-1", "u", CLOCK);
      expect(tx.cashCredit.aggregate).not.toHaveBeenCalled();
    });
  });

  it("does nothing when every month is already credited (idempotent)", async () => {
    const tx = makeTx();
    tx.userProfile.findUnique.mockResolvedValue(profile);
    tx.cashCredit.findMany.mockResolvedValue([{ month: d("2026-09") }, { month: d("2026-10") }]);
    tx.recurringRule.findMany.mockResolvedValue([]);
    await advance(asTx(tx), "plan-1", "u", CLOCK);
    expect(tx.cashCredit.createMany).not.toHaveBeenCalled();
  });

  it("needs a profile", async () => {
    const tx = makeTx();
    tx.userProfile.findUnique.mockResolvedValue(null);
    await expect(advance(asTx(tx), "plan-1", "u", CLOCK)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("runDueRules (recurring buys)", () => {
  const rule = (over: object = {}) => ({
    id: "r1",
    planId: "plan-1",
    fundId: "fa",
    portfolioId: null,
    amount: "100.00",
    startMonth: d("2026-10"),
    endMonth: null,
    createdAt: new Date("2026-10-01"),
    runs: [] as { month: Date }[],
    portfolio: null as null | { allocations: { fundId: string; weightPct: string }[] },
    ...over,
  });

  /** cash at the start of a month, as the aggregates would report it */
  function cashIs(tx: Tx, cash: number) {
    tx.cashCredit.aggregate.mockResolvedValue({ _sum: { amount: String(cash) } });
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
  }

  it("does nothing without rules", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([]);
    await runDueRules(asTx(tx), "plan-1", CLOCK);
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it("buys the fund and records a BOUGHT run when there is enough cash", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([rule()]);
    cashIs(tx, 500);

    await runDueRules(asTx(tx), "plan-1", CLOCK);

    const call = tx.ledgerEntry.createMany.mock.calls[0][0].data;
    expect(call).toHaveLength(1);
    expect(call[0]).toMatchObject({ planId: "plan-1", side: "BUY", fundId: "fa", amount: 100, source: "RECURRING", month: d("2026-10") });
    expect(tx.recurringRun.create).toHaveBeenCalledWith({ data: { ruleId: "r1", month: d("2026-10"), status: "BOUGHT" } });
  });

  it("records a SKIPPED run, and buys nothing, when cash is short", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([rule()]);
    cashIs(tx, 99.99);

    await runDueRules(asTx(tx), "plan-1", CLOCK);

    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(tx.recurringRun.create).toHaveBeenCalledWith({ data: { ruleId: "r1", month: d("2026-10"), status: "SKIPPED" } });
  });

  it("splits a portfolio rule across its funds by weight, as one batch", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([
      rule({ fundId: null, portfolioId: "pf", amount: "100.00", portfolio: { allocations: [{ fundId: "fa", weightPct: "60.00" }, { fundId: "fb", weightPct: "40.00" }] } }),
    ]);
    cashIs(tx, 500);

    await runDueRules(asTx(tx), "plan-1", CLOCK);

    const data = tx.ledgerEntry.createMany.mock.calls[0][0].data;
    expect(data.map((l: { fundId: string; amount: number }) => [l.fundId, l.amount])).toEqual([["fa", 60], ["fb", 40]]);
    expect(new Set(data.map((l: { batchId: string }) => l.batchId)).size).toBe(1);
  });

  it("skips (rather than failing) a rule whose portfolio has been deleted", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([rule({ fundId: null, portfolioId: null })]);
    cashIs(tx, 500);
    await runDueRules(asTx(tx), "plan-1", CLOCK);
    expect(tx.recurringRun.create.mock.calls[0][0].data.status).toBe("SKIPPED");
  });

  it("does not run a month a rule has already run (idempotent)", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([rule({ runs: [{ month: d("2026-10") }] })]);
    cashIs(tx, 500);
    await runDueRules(asTx(tx), "plan-1", CLOCK);
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(tx.recurringRun.create).not.toHaveBeenCalled();
  });

  it("catches up every missed month, oldest first, each against that month's own cash", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([rule({ startMonth: d("2026-08") })]);
    const cashByCall = [250, 50, 500]; // Aug ok, Sep short, Oct ok
    let i = 0;
    tx.cashCredit.aggregate.mockImplementation(() => Promise.resolve({ _sum: { amount: String(cashByCall[i++]) } }));
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await runDueRules(asTx(tx), "plan-1", CLOCK);

    expect(tx.recurringRun.create.mock.calls.map((c) => [c[0].data.month.toISOString().slice(0, 7), c[0].data.status])).toEqual([
      ["2026-08", "BOUGHT"],
      ["2026-09", "SKIPPED"],
      ["2026-10", "BOUGHT"],
    ]);
  });

  it("does not run before a rule starts or after it ends", async () => {
    const tx = makeTx();
    tx.recurringRule.findMany.mockResolvedValue([rule({ startMonth: d("2026-09"), endMonth: d("2026-09") })]);
    cashIs(tx, 500);
    await runDueRules(asTx(tx), "plan-1", CLOCK);
    // only September: October is after the end
    expect(tx.recurringRun.create.mock.calls.map((c) => c[0].data.month.toISOString().slice(0, 7))).toEqual(["2026-09"]);
  });
});

describe("persistDerived", () => {
  const state = {
    points: [{ month: "2026-09", portfolioReturn: 0.0123456789, hasPosition: true, netFlow: 100, endingValue: 101.23, totalInvested: 100, cash: 50 }],
    holdings: [{ fundId: "fa", value: 101.23, costBasis: 100 }],
    cash: 50,
    netInvested: 100,
    firstBuyMonth: "2026-09",
    facts: { credits: [{ month: "2026-08", amount: 100 }], entries: [{ month: "2026-09", side: "BUY" as const, fundId: "fa", amount: 100 }] },
  };

  it("stores each month, replaces the holdings, and sets the typical monthly buy and start month", async () => {
    const tx = makeTx();
    await persistDerived(asTx(tx), "plan-1", state, CLOCK);

    expect(tx.planMonth.upsert).toHaveBeenCalledTimes(1);
    expect(tx.planMonth.upsert.mock.calls[0][0].create).toMatchObject({ planId: "plan-1", monthDate: d("2026-09"), portfolioReturnPct: 0.012346, contribution: 100, endingBalance: 101.23, hasPosition: true });
    expect(tx.planHolding.deleteMany).toHaveBeenCalledWith({ where: { planId: "plan-1" } });
    expect(tx.planHolding.createMany).toHaveBeenCalledWith({ data: [{ planId: "plan-1", fundId: "fa", value: 101.23, costBasis: 100 }] });
    expect(tx.plan.update).toHaveBeenCalledWith({ where: { id: "plan-1" }, data: { contributionAmount: 50, startMonth: d("2026-09") } });
  });

  it("clears the holdings when nothing is held, and keeps the account's opening month as the start", async () => {
    const tx = makeTx();
    await persistDerived(asTx(tx), "plan-1", { ...state, points: [], holdings: [], firstBuyMonth: null, facts: { credits: [{ month: "2026-10", amount: 1 }], entries: [] } }, CLOCK);
    expect(tx.planHolding.deleteMany).toHaveBeenCalled();
    expect(tx.planHolding.createMany).not.toHaveBeenCalled();
    expect(tx.plan.update.mock.calls[0][0].data).toEqual({ contributionAmount: 0, startMonth: d("2026-10") });
  });
});

describe("refreshAccount", () => {
  it("is null without a profile", async () => {
    db.userProfile.findUnique.mockResolvedValue(null);
    expect(await refreshAccount("u")).toBeNull();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("when reading someone else's account it never opens one for them", async () => {
    db.userProfile.findUnique.mockResolvedValue({ userId: "u" });
    db.plan.findUnique.mockResolvedValue(null);
    expect(await refreshAccount("u", { advance: false })).toBeNull();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
