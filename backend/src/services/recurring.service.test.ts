/**
 * RecurringService (DECISIONS.md #19, PR 3): list, set up, change, pause and resume a monthly
 * buy. Prisma and the ledger service are mocked; rules live in a small in-memory store so the
 * history rules (pause ends, resume reopens or restarts, change ends and restarts) can be checked.
 */
import { prisma } from "../config/prisma";
import { advance, computeState, ensureAccount, getClock, lockPlan, persistDerived, runDueRules } from "./ledger.service";
import { MAX_ACTIVE_RULES, recurringService } from "./recurring.service";

jest.mock("../config/prisma", () => ({ prisma: { $transaction: jest.fn(), userProfile: { findUnique: jest.fn() } } }));
jest.mock("./ledger.service", () => ({
  advance: jest.fn(),
  computeState: jest.fn(),
  ensureAccount: jest.fn(),
  getClock: jest.fn(),
  lockPlan: jest.fn(),
  persistDerived: jest.fn(),
  runDueRules: jest.fn(),
  monthDate: (m: string) => new Date(`${m}-01T00:00:00.000Z`),
  monthKey: (d: Date) => d.toISOString().slice(0, 7),
}));

const db = prisma as unknown as { $transaction: jest.Mock; userProfile: { findUnique: jest.Mock } };
const ledger = { advance, computeState, ensureAccount, getClock, lockPlan, persistDerived, runDueRules } as unknown as Record<string, jest.Mock>;

const CLOCK = { latestDataMonth: "2026-09", tradeMonth: "2026-10" };
const FUND_A = "11111111-1111-4111-8111-111111111111";
const FUND_B = "22222222-2222-4222-8222-222222222222";
const PF = "33333333-3333-4333-8333-333333333333";
const d = (m: string) => new Date(`${m}-01T00:00:00.000Z`);

interface Row {
  id: string;
  planId: string;
  fundId: string | null;
  portfolioId: string | null;
  amount: string;
  startMonth: Date;
  endMonth: Date | null;
  createdAt: Date;
  runs: { month: Date; status: "BOUGHT" | "SKIPPED" }[];
}

let rules: Row[];
let seq: number;

function rule(over: Partial<Row> = {}): Row {
  seq += 1;
  return { id: `rule-${seq}`, planId: "plan-1", fundId: FUND_A, portfolioId: null, amount: "100.00", startMonth: d("2026-08"), endMonth: null, createdAt: new Date(2026, 0, seq), runs: [], ...over };
}

const tx = {
  recurringRule: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  fund: { findUnique: jest.fn() },
  portfolio: { findUnique: jest.fn() },
  ledgerEntry: { groupBy: jest.fn() },
};

beforeEach(() => {
  jest.resetAllMocks();
  rules = [];
  seq = 0;
  ledger.getClock.mockResolvedValue(CLOCK);
  ledger.ensureAccount.mockResolvedValue({ id: "plan-1" });
  ledger.computeState.mockResolvedValue({ cash: 900 });
  db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  db.userProfile.findUnique.mockResolvedValue({ userId: "u" });

  tx.recurringRule.findMany.mockImplementation(() =>
    Promise.resolve(
      [...rules]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({
          ...r,
          fund: r.fundId ? { ticker: r.fundId === FUND_A ? "AAA" : "BBB", name: r.fundId === FUND_A ? "Fund A" : "Fund B" } : null,
          portfolio: r.portfolioId ? { name: "Balanced mix" } : null,
          runs: [...r.runs].sort((a, b) => b.month.getTime() - a.month.getTime()),
        }))
    )
  );
  tx.recurringRule.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(rules.find((r) => r.id === where.id) ?? null));
  tx.recurringRule.create.mockImplementation(({ data }: { data: Partial<Row> }) => {
    const r = rule({ ...data, amount: String(data.amount), endMonth: null });
    rules.push(r);
    return Promise.resolve(r);
  });
  tx.recurringRule.update.mockImplementation(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    Object.assign(rules.find((r) => r.id === where.id)!, data);
    return Promise.resolve();
  });
  tx.fund.findUnique.mockResolvedValue({ id: FUND_A });
  tx.portfolio.findUnique.mockResolvedValue({ id: PF, userId: null, allocations: [{ id: "a" }] });
  tx.ledgerEntry.groupBy.mockResolvedValue([]);
  // the runner: record a BOUGHT run for every active rule that has none this month
  ledger.runDueRules.mockImplementation(async () => {
    for (const r of rules) if (!r.runs.some((x) => x.month.getTime() === d("2026-10").getTime()) && r.startMonth <= d("2026-10") && !r.endMonth) r.runs.push({ month: d("2026-10"), status: "BOUGHT" });
  });
});

describe("list", () => {
  it("is empty for a user without an account", async () => {
    db.userProfile.findUnique.mockResolvedValue(null);
    expect(await recurringService.list("u")).toEqual({ tradeMonth: null, rules: [], consistency: null });
  });

  it("shows each target's newest rule, with its status and recent runs", async () => {
    rules.push(rule({ endMonth: d("2026-08"), startMonth: d("2026-01") })); // an old, superseded rule for fund A
    rules.push(rule({ startMonth: d("2026-09"), runs: [{ month: d("2026-09"), status: "SKIPPED" }, { month: d("2026-10"), status: "BOUGHT" }] }));
    rules.push(rule({ fundId: null, portfolioId: PF, amount: "50.00", endMonth: d("2026-09") }));

    const { rules: out, tradeMonth } = await recurringService.list("u");

    expect(tradeMonth).toBe("2026-10");
    expect(out).toHaveLength(2); // fund A once, the portfolio once
    const fund = out.find((r) => r.kind === "FUND")!;
    expect(fund).toMatchObject({ targetName: "AAA · Fund A", amount: 100, status: "ACTIVE", startMonth: "2026-09", endMonth: null });
    expect(fund.runs).toEqual([{ month: "2026-10", status: "BOUGHT" }, { month: "2026-09", status: "SKIPPED" }]);
    expect(out.find((r) => r.kind === "PORTFOLIO")).toMatchObject({ targetName: "Balanced mix", amount: 50, status: "PAUSED", endMonth: "2026-09" });
  });

  it("includes contribution consistency from the months with a buy", async () => {
    tx.ledgerEntry.groupBy.mockResolvedValue(["2026-06", "2026-07", "2026-09", "2026-10"].map((m) => ({ month: d(m) })));
    expect((await recurringService.list("u")).consistency).toEqual({ monthsWithBuy: 4, monthsCounted: 5, pct: 80 });
  });

  it("catches the account up first, so a month's runs are current", async () => {
    await recurringService.list("u");
    expect(ledger.lockPlan).toHaveBeenCalled();
    expect(ledger.advance).toHaveBeenCalled();
  });
});

describe("create", () => {
  it("starts a rule this trade month and runs it now, reporting the first buy", async () => {
    const res = await recurringService.create("u", { fundId: FUND_A, amount: 100 });

    expect(tx.recurringRule.create.mock.calls[0][0].data).toMatchObject({ planId: "plan-1", fundId: FUND_A, portfolioId: null, amount: 100, startMonth: d("2026-10") });
    expect(ledger.runDueRules).toHaveBeenCalled();
    expect(res).toMatchObject({ firstRun: "BOUGHT", cash: 900, rule: { status: "ACTIVE", amount: 100, kind: "FUND" } });
  });

  it("reports a skipped first run when the month's cash cannot cover it", async () => {
    ledger.runDueRules.mockImplementation(async () => void rules[0].runs.push({ month: d("2026-10"), status: "SKIPPED" }));
    expect((await recurringService.create("u", { fundId: FUND_A, amount: 5000 })).firstRun).toBe("SKIPPED");
  });

  it("can repeat a portfolio, but not another user's", async () => {
    await expect(recurringService.create("u", { portfolioId: PF, amount: 50 })).resolves.toMatchObject({ rule: { kind: "PORTFOLIO" } });
    tx.portfolio.findUnique.mockResolvedValue({ id: PF, userId: "someone-else", allocations: [{ id: "a" }] });
    await expect(recurringService.create("u", { portfolioId: PF, amount: 50 })).rejects.toMatchObject({ statusCode: 404 });
    tx.portfolio.findUnique.mockResolvedValue({ id: PF, userId: null, allocations: [] });
    await expect(recurringService.create("u", { portfolioId: PF, amount: 50 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404s for a missing fund", async () => {
    tx.fund.findUnique.mockResolvedValue(null);
    await expect(recurringService.create("u", { fundId: FUND_A, amount: 10 })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses a second running monthly buy for the same target", async () => {
    rules.push(rule());
    await expect(recurringService.create("u", { fundId: FUND_A, amount: 20 })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.recurringRule.create).not.toHaveBeenCalled();
  });

  it("allows one for a target whose monthly buy is paused", async () => {
    rules.push(rule({ endMonth: d("2026-08") }));
    await expect(recurringService.create("u", { fundId: FUND_A, amount: 20 })).resolves.toBeDefined();
  });

  it(`caps the running monthly buys at ${MAX_ACTIVE_RULES}`, async () => {
    for (let i = 0; i < MAX_ACTIVE_RULES; i++) rules.push(rule({ fundId: `fund-${i}` }));
    await expect(recurringService.create("u", { fundId: FUND_B, amount: 20 })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("validates: one target, at least $1, at most $100,000", async () => {
    await expect(recurringService.create("u", { amount: 10 })).rejects.toThrow();
    await expect(recurringService.create("u", { fundId: FUND_A, portfolioId: PF, amount: 10 })).rejects.toThrow();
    await expect(recurringService.create("u", { fundId: FUND_A, amount: 0.5 })).rejects.toThrow();
    await expect(recurringService.create("u", { fundId: FUND_A, amount: 100_001 })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("pause", () => {
  it("ends the rule this month: it has already run, so it stops from next month", async () => {
    const r = rule({ startMonth: d("2026-08") });
    rules.push(r);
    const view = await recurringService.pause("u", r.id);
    expect(r.endMonth).toEqual(d("2026-10"));
    expect(view).toMatchObject({ status: "PAUSED", endMonth: "2026-10" });
  });

  it("refuses to pause what is already paused", async () => {
    const r = rule({ endMonth: d("2026-09") });
    rules.push(r);
    await expect(recurringService.pause("u", r.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("404s for a rule that is not yours or does not exist, the same way", async () => {
    const other = rule({ planId: "someone-elses-plan" });
    rules.push(other);
    await expect(recurringService.pause("u", other.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(recurringService.pause("u", "nope")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("resume", () => {
  it("starts a NEW rule from this month when it was paused in an earlier month, and runs it now", async () => {
    const old = rule({ endMonth: d("2026-08"), amount: "75.00" });
    rules.push(old);

    const res = await recurringService.resume("u", old.id);

    expect(rules).toHaveLength(2);
    expect(tx.recurringRule.create.mock.calls[0][0].data).toMatchObject({ fundId: FUND_A, amount: old.amount, startMonth: d("2026-10") });
    expect(old.endMonth).toEqual(d("2026-08")); // history untouched
    expect(res).toMatchObject({ firstRun: "BOUGHT", rule: { status: "ACTIVE", amount: 75 } });
  });

  it("REOPENS the same rule when it was paused this very month, so it cannot buy twice in a month", async () => {
    const r = rule({ endMonth: d("2026-10"), runs: [{ month: d("2026-10"), status: "BOUGHT" }] });
    rules.push(r);

    const res = await recurringService.resume("u", r.id);

    expect(rules).toHaveLength(1);
    expect(r.endMonth).toBeNull();
    expect(res).toMatchObject({ firstRun: null, rule: { status: "ACTIVE" } });
    expect(ledger.runDueRules).not.toHaveBeenCalled();
  });

  it("refuses to resume one that is already running", async () => {
    const r = rule();
    rules.push(r);
    await expect(recurringService.resume("u", r.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses to resume a rule that a newer one has replaced", async () => {
    const old = rule({ endMonth: d("2026-08") });
    rules.push(old, rule({ startMonth: d("2026-09") }));
    await expect(recurringService.resume("u", old.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it(`respects the cap of ${MAX_ACTIVE_RULES} running monthly buys`, async () => {
    const old = rule({ endMonth: d("2026-08") });
    rules.push(old);
    for (let i = 0; i < MAX_ACTIVE_RULES; i++) rules.push(rule({ fundId: `fund-${i}` }));
    await expect(recurringService.resume("u", old.id)).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("changeAmount", () => {
  it("ends the rule this month and starts a new one with the new amount NEXT month", async () => {
    const r = rule();
    rules.push(r);

    const view = await recurringService.changeAmount("u", r.id, { amount: 150 });

    expect(r.endMonth).toEqual(d("2026-10"));
    expect(rules).toHaveLength(2);
    expect(tx.recurringRule.create.mock.calls[0][0].data).toMatchObject({ fundId: FUND_A, amount: 150, startMonth: d("2026-11") });
    expect(view).toMatchObject({ amount: 150, status: "ACTIVE", startMonth: "2026-11" });
    expect(ledger.runDueRules).not.toHaveBeenCalled(); // nothing extra runs this month
  });

  it("does nothing when the amount is the same", async () => {
    const r = rule();
    rules.push(r);
    await recurringService.changeAmount("u", r.id, { amount: 100 });
    expect(rules).toHaveLength(1);
    expect(r.endMonth).toBeNull();
  });

  it("refuses to change one that is paused, or one that has not started yet", async () => {
    const paused = rule({ endMonth: d("2026-09") });
    const future = rule({ fundId: FUND_B, startMonth: d("2026-11") });
    rules.push(paused, future);
    await expect(recurringService.changeAmount("u", paused.id, { amount: 10 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(recurringService.changeAmount("u", future.id, { amount: 10 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("validates the amount and the owner", async () => {
    const r = rule();
    rules.push(r);
    await expect(recurringService.changeAmount("u", r.id, { amount: 0 })).rejects.toThrow();
    await expect(recurringService.changeAmount("u", "nope", { amount: 10 })).rejects.toMatchObject({ statusCode: 404 });
  });
});
