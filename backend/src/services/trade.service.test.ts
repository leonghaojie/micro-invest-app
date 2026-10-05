/**
 * TradeService (DECISIONS.md #19): buy, sell and the activity list. Prisma and the ledger
 * service are mocked; the replay arithmetic is tested in utils/ledger.test.ts.
 */
import { prisma } from "../config/prisma";
import { advance, computeState, ensureAccount, getClock, lockPlan, persistDerived } from "./ledger.service";
import { tradeService } from "./trade.service";

const tx = {
  fund: { findUnique: jest.fn(), findMany: jest.fn() },
  portfolio: { findUnique: jest.fn() },
  ledgerEntry: { createMany: jest.fn(), create: jest.fn() },
};

jest.mock("../config/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    plan: { findUnique: jest.fn() },
    ledgerEntry: { findMany: jest.fn() },
    cashCredit: { findMany: jest.fn() },
    recurringRun: { findMany: jest.fn() },
  },
}));
jest.mock("./ledger.service", () => ({
  advance: jest.fn(),
  computeState: jest.fn(),
  ensureAccount: jest.fn(),
  getClock: jest.fn(),
  lockPlan: jest.fn(),
  persistDerived: jest.fn(),
  monthDate: (m: string) => new Date(`${m}-01T00:00:00.000Z`),
  monthKey: (d: Date) => d.toISOString().slice(0, 7),
}));

const db = prisma as unknown as {
  $transaction: jest.Mock;
  plan: { findUnique: jest.Mock };
  ledgerEntry: { findMany: jest.Mock };
  cashCredit: { findMany: jest.Mock };
  recurringRun: { findMany: jest.Mock };
};
const ledger = { advance, computeState, ensureAccount, getClock, lockPlan, persistDerived } as unknown as Record<string, jest.Mock>;

const CLOCK = { latestDataMonth: "2026-09", tradeMonth: "2026-10" };
const FUND_A = "11111111-1111-4111-8111-111111111111";
const FUND_B = "22222222-2222-4222-8222-222222222222";
const PF = "33333333-3333-4333-8333-333333333333";

function stateWith(cash: number, holdings: { fundId: string; value: number; costBasis?: number }[] = []) {
  return { cash, holdings: holdings.map((h) => ({ costBasis: h.value, ...h })), points: [], netInvested: 0, firstBuyMonth: null, facts: { credits: [], entries: [] } };
}

beforeEach(() => {
  jest.resetAllMocks();
  ledger.getClock.mockResolvedValue(CLOCK);
  ledger.ensureAccount.mockResolvedValue({ id: "plan-1" });
  db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  tx.fund.findUnique.mockResolvedValue({ id: FUND_A });
  tx.fund.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.map((id) => ({ id, ticker: id === FUND_A ? "AAA" : "BBB", name: id === FUND_A ? "Fund A" : "Fund B" })))
  );
  ledger.computeState.mockResolvedValue(stateWith(1000));
  db.recurringRun.findMany.mockResolvedValue([]);
});

describe("buy a fund", () => {
  it("writes a MANUAL buy in the trade month and returns the new cash", async () => {
    ledger.computeState.mockResolvedValueOnce(stateWith(1000)).mockResolvedValueOnce(stateWith(700));

    const result = await tradeService.buy("u", { fundId: FUND_A, amount: 300 });

    const data = tx.ledgerEntry.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ planId: "plan-1", side: "BUY", fundId: FUND_A, amount: 300, source: "MANUAL", month: new Date("2026-10-01T00:00:00.000Z") });
    expect(result).toMatchObject({ side: "BUY", tradeMonth: "2026-10", total: 300, cash: 700, legs: [{ fundId: FUND_A, ticker: "AAA", amount: 300 }] });
    expect(ledger.persistDerived).toHaveBeenCalled();
  });

  it("locks the account and catches it up BEFORE checking cash, so the numbers it checks are current", async () => {
    const order: string[] = [];
    ledger.lockPlan.mockImplementation(async () => void order.push("lock"));
    ledger.advance.mockImplementation(async () => void order.push("advance"));
    ledger.computeState.mockImplementation(async () => {
      order.push("state");
      return stateWith(1000);
    });
    await tradeService.buy("u", { fundId: FUND_A, amount: 10 });
    expect(order.slice(0, 3)).toEqual(["lock", "advance", "state"]);
  });

  it("allows spending exactly all the cash", async () => {
    ledger.computeState.mockResolvedValue(stateWith(250.5));
    await expect(tradeService.buy("u", { fundId: FUND_A, amount: 250.5 })).resolves.toMatchObject({ total: 250.5 });
  });

  it("refuses more than the cash, by even one cent, and writes nothing", async () => {
    ledger.computeState.mockResolvedValue(stateWith(250.5));
    await expect(tradeService.buy("u", { fundId: FUND_A, amount: 250.51 })).rejects.toMatchObject({ statusCode: 422, message: "Not enough cash: you have $250.50 available." });
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it("404s for a fund that does not exist", async () => {
    tx.fund.findUnique.mockResolvedValue(null);
    await expect(tradeService.buy("u", { fundId: FUND_A, amount: 10 })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("validates the request: a target, one only, and at least $1", async () => {
    await expect(tradeService.buy("u", { amount: 10 })).rejects.toThrow();
    await expect(tradeService.buy("u", { fundId: FUND_A, portfolioId: PF, amount: 10 })).rejects.toThrow();
    await expect(tradeService.buy("u", { fundId: FUND_A, amount: 0.5 })).rejects.toThrow();
    await expect(tradeService.buy("u", { fundId: FUND_A, amount: -5 })).rejects.toThrow();
    await expect(tradeService.buy("u", { fundId: "not-a-uuid", amount: 5 })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("buy a portfolio", () => {
  const portfolio = (over: object = {}) => ({
    id: PF,
    userId: null,
    allocations: [
      { fundId: FUND_A, weightPct: "60.00" },
      { fundId: FUND_B, weightPct: "40.00" },
    ],
    ...over,
  });

  it("splits the amount across its funds by weight, as one batch of legs that add up exactly", async () => {
    tx.portfolio.findUnique.mockResolvedValue(portfolio());
    ledger.computeState.mockResolvedValueOnce(stateWith(1000)).mockResolvedValueOnce(stateWith(899.99));

    const result = await tradeService.buy("u", { portfolioId: PF, amount: 100.01 });

    const data = tx.ledgerEntry.createMany.mock.calls[0][0].data;
    expect(data.map((l: { fundId: string; amount: number }) => [l.fundId, l.amount])).toEqual([[FUND_A, 60.01], [FUND_B, 40]]);
    expect(Math.round(data.reduce((s: number, l: { amount: number }) => s + l.amount * 100, 0))).toBe(10001);
    expect(new Set(data.map((l: { batchId: string }) => l.batchId)).size).toBe(1);
    expect(result.legs).toHaveLength(2);
    expect(result.total).toBe(100.01);
  });

  it("can buy a preset or the user's own portfolio, but another user's is a 404", async () => {
    tx.portfolio.findUnique.mockResolvedValue(portfolio({ userId: "u" }));
    await expect(tradeService.buy("u", { portfolioId: PF, amount: 10 })).resolves.toBeDefined();

    tx.portfolio.findUnique.mockResolvedValue(portfolio({ userId: "someone-else" }));
    await expect(tradeService.buy("u", { portfolioId: PF, amount: 10 })).rejects.toMatchObject({ statusCode: 404 });
    tx.portfolio.findUnique.mockResolvedValue(null);
    await expect(tradeService.buy("u", { portfolioId: PF, amount: 10 })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("400s for a portfolio with no funds", async () => {
    tx.portfolio.findUnique.mockResolvedValue(portfolio({ allocations: [] }));
    await expect(tradeService.buy("u", { portfolioId: PF, amount: 10 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("checks the whole amount against cash, not each leg", async () => {
    tx.portfolio.findUnique.mockResolvedValue(portfolio());
    ledger.computeState.mockResolvedValue(stateWith(50));
    await expect(tradeService.buy("u", { portfolioId: PF, amount: 80 })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("sell", () => {
  beforeEach(() => {
    ledger.computeState.mockResolvedValue(stateWith(100, [{ fundId: FUND_A, value: 250.75 }]));
  });

  it("sells part of a holding and returns the new cash", async () => {
    ledger.computeState.mockResolvedValueOnce(stateWith(100, [{ fundId: FUND_A, value: 250.75 }])).mockResolvedValueOnce(stateWith(150));
    const result = await tradeService.sell("u", { fundId: FUND_A, amount: 50 });

    expect(tx.ledgerEntry.create.mock.calls[0][0].data).toMatchObject({ planId: "plan-1", side: "SELL", fundId: FUND_A, amount: 50, source: "MANUAL" });
    expect(result).toMatchObject({ side: "SELL", total: 50, cash: 150, legs: [{ ticker: "AAA", amount: 50 }] });
  });

  it("'sell all' sells exactly what is held", async () => {
    await tradeService.sell("u", { fundId: FUND_A, all: true });
    expect(tx.ledgerEntry.create.mock.calls[0][0].data.amount).toBe(250.75);
  });

  it("allows selling exactly the whole holding, and refuses one cent more", async () => {
    await expect(tradeService.sell("u", { fundId: FUND_A, amount: 250.75 })).resolves.toBeDefined();
    await expect(tradeService.sell("u", { fundId: FUND_A, amount: 250.76 })).rejects.toMatchObject({ statusCode: 422, message: "You can sell at most $250.75 of this fund." });
  });

  it("refuses to sell a fund the user does not hold", async () => {
    await expect(tradeService.sell("u", { fundId: FUND_B, amount: 10 })).rejects.toMatchObject({ statusCode: 422, message: "You don't hold this fund." });
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("needs an amount or 'all', not both and not neither, and at least $1", async () => {
    await expect(tradeService.sell("u", { fundId: FUND_A })).rejects.toThrow();
    await expect(tradeService.sell("u", { fundId: FUND_A, amount: 10, all: true })).rejects.toThrow();
    await expect(tradeService.sell("u", { fundId: FUND_A, amount: 0.5 })).rejects.toThrow();
  });
});

describe("history", () => {
  it("is empty for a user without an account", async () => {
    db.plan.findUnique.mockResolvedValue(null);
    expect(await tradeService.history("u")).toEqual([]);
  });

  it("merges buys, sells and cash credits, newest month first, then newest within a month", async () => {
    db.plan.findUnique.mockResolvedValue({ id: "plan-1" });
    db.ledgerEntry.findMany.mockResolvedValue([
      { side: "SELL", month: new Date("2026-10-01"), amount: "40", source: "MANUAL", fundId: FUND_A, fund: { ticker: "AAA", name: "Fund A" }, batchId: "b2", createdAt: new Date("2026-10-05T10:00:00Z") },
      { side: "BUY", month: new Date("2026-10-01"), amount: "100", source: "MANUAL", fundId: FUND_A, fund: { ticker: "AAA", name: "Fund A" }, batchId: "b1", createdAt: new Date("2026-10-04T10:00:00Z") },
      { side: "BUY", month: new Date("2026-09-01"), amount: "50", source: "MIGRATED", fundId: FUND_A, fund: { ticker: "AAA", name: "Fund A" }, batchId: null, createdAt: new Date("2026-09-30T10:00:00Z") },
    ]);
    db.cashCredit.findMany.mockResolvedValue([{ month: new Date("2026-10-01"), amount: "1600", source: "SETUP", createdAt: new Date("2026-10-03T10:00:00Z") }]);

    const items = await tradeService.history("u");

    expect(items.map((i) => [i.kind, i.month, i.amount])).toEqual([
      ["SELL", "2026-10", 40],
      ["BUY", "2026-10", 100],
      ["CREDIT", "2026-10", 1600],
      ["BUY", "2026-09", 50],
    ]);
    expect(items[2]).toMatchObject({ fundId: null, ticker: null });
  });

  it("shows a monthly buy that was skipped for lack of cash, so a missed month is visible", async () => {
    db.plan.findUnique.mockResolvedValue({ id: "plan-1" });
    db.ledgerEntry.findMany.mockResolvedValue([]);
    db.cashCredit.findMany.mockResolvedValue([{ month: new Date("2026-10-01"), amount: "1600", source: "MONTHLY", createdAt: new Date("2026-10-01T00:00:00Z") }]);
    db.recurringRun.findMany.mockResolvedValue([
      { month: new Date("2026-10-01"), createdAt: new Date("2026-10-02T00:00:00Z"), rule: { amount: "300.00", fund: { ticker: "AAA", name: "Fund A" }, portfolio: null } },
      { month: new Date("2026-09-01"), createdAt: new Date("2026-09-02T00:00:00Z"), rule: { amount: "50.00", fund: null, portfolio: { name: "Balanced mix" } } },
    ]);

    const items = await tradeService.history("u");

    expect(db.recurringRun.findMany.mock.calls[0][0].where).toEqual({ status: "SKIPPED", rule: { planId: "plan-1" } });
    expect(items.map((i) => [i.kind, i.month, i.amount, i.ticker ?? i.name])).toEqual([
      ["SKIPPED", "2026-10", 300, "AAA"],
      ["CREDIT", "2026-10", 1600, null],
      ["SKIPPED", "2026-09", 50, "Balanced mix"],
    ]);
  });

  it("respects the limit", async () => {
    db.plan.findUnique.mockResolvedValue({ id: "plan-1" });
    db.ledgerEntry.findMany.mockResolvedValue([]);
    db.cashCredit.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ month: new Date(`2026-0${i + 1}-01`), amount: "1", source: "MONTHLY", createdAt: new Date() })));
    expect(await tradeService.history("u", 3)).toHaveLength(3);
  });
});
