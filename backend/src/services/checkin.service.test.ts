/**
 * CheckInService (DECISIONS.md #31): the monthly check-in replaces the current month's cash credit
 * with income minus expenses (possibly negative, paid from cash), leaves the profile's usual
 * figures alone unless asked, and refuses what the cash cannot cover. Prisma and the ledger
 * service are mocked so these run without a live Postgres connection.
 */
import { prisma } from "../config/prisma";
import { checkInService } from "./checkin.service";
import { advance, computeState, ensureAccount, getClock, lockPlan, persistDerived } from "./ledger.service";

const tx = {
  userProfile: { findUnique: jest.fn(), update: jest.fn() },
  cashCredit: { findUnique: jest.fn(), update: jest.fn() },
  monthlyCheckIn: { findUnique: jest.fn(), upsert: jest.fn() },
};

jest.mock("../config/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock("./ledger.service", () => ({
  advance: jest.fn(),
  computeState: jest.fn(),
  ensureAccount: jest.fn(),
  getClock: jest.fn(),
  lockPlan: jest.fn(),
  persistDerived: jest.fn(),
  monthDate: (m: string) => new Date(`${m}-01T00:00:00.000Z`),
}));

const db = prisma as unknown as { $transaction: jest.Mock };
const ledger = { advance, computeState, ensureAccount, getClock, lockPlan, persistDerived } as unknown as Record<string, jest.Mock>;

const CLOCK = { latestDataMonth: "2026-09", tradeMonth: "2026-10" };
const OCT = new Date("2026-10-01T00:00:00.000Z");
const PROFILE = { userId: "u", monthlyIncome: "4000.00", monthlyExpense: "2400.00" }; // usual spare 1600

beforeEach(() => {
  jest.resetAllMocks();
  ledger.getClock.mockResolvedValue(CLOCK);
  ledger.ensureAccount.mockResolvedValue({ id: "plan-1" });
  ledger.computeState.mockResolvedValue({ cash: 900 });
  db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  tx.userProfile.findUnique.mockResolvedValue(PROFILE);
  tx.cashCredit.findUnique.mockResolvedValue({ id: "credit-1", amount: "1600.00" });
  tx.monthlyCheckIn.findUnique.mockResolvedValue(null);
});

describe("current", () => {
  it("is unconfirmed, prefilled with the usual figures, until the user reports the month", async () => {
    const view = await checkInService.current("u");

    expect(view).toEqual({
      month: "2026-10",
      confirmed: false,
      usual: { income: 4000, expense: 2400 },
      thisMonth: { income: 4000, expense: 2400 },
      credit: 1600,
      cash: 900,
    });
  });

  it("shows what the user reported once they have", async () => {
    tx.monthlyCheckIn.findUnique.mockResolvedValue({ income: "4000.00", expense: "6500.00" });
    tx.cashCredit.findUnique.mockResolvedValue({ id: "credit-1", amount: "-2500.00" });

    const view = await checkInService.current("u");

    expect(view).toMatchObject({ confirmed: true, thisMonth: { income: 4000, expense: 6500 }, usual: { income: 4000, expense: 2400 }, credit: -2500 });
  });

  it("catches the account up first, under the lock", async () => {
    await checkInService.current("u");
    expect(ledger.lockPlan).toHaveBeenCalledWith(tx, "plan-1");
    expect(ledger.advance).toHaveBeenCalled();
  });

  it("needs a profile", async () => {
    tx.userProfile.findUnique.mockResolvedValue(null);
    await expect(checkInService.current("u")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("submit", () => {
  it("confirming the usual figures records the month and leaves the credit as it is", async () => {
    await checkInService.submit("u", { income: 4000, expense: 2400 });

    expect(tx.cashCredit.update).toHaveBeenCalledWith({ where: { id: "credit-1" }, data: { amount: 1600, source: "CHECKIN" } });
    expect(tx.monthlyCheckIn.upsert).toHaveBeenCalledWith({
      where: { planId_month: { planId: "plan-1", month: OCT } },
      create: { planId: "plan-1", month: OCT, income: 4000, expense: 2400 },
      update: { income: 4000, expense: 2400 },
    });
  });

  it("a big one-off expense replaces only this month's credit, with a negative amount, and leaves the profile alone", async () => {
    ledger.computeState.mockResolvedValue({ cash: 5000 });

    await checkInService.submit("u", { income: 4000, expense: 6500 }); // spent $2,500 more than earned

    expect(tx.cashCredit.update).toHaveBeenCalledWith({ where: { id: "credit-1" }, data: { amount: -2500, source: "CHECKIN" } });
    expect(tx.userProfile.update).not.toHaveBeenCalled();
  });

  it("is paid from the cash the account has: a shortfall the cash covers is allowed", async () => {
    ledger.computeState.mockResolvedValue({ cash: 4100 }); // 4100 + (-2500 - 1600) = 0
    await expect(checkInService.submit("u", { income: 4000, expense: 6500 })).resolves.toBeDefined();
  });

  it("refuses when the cash cannot cover it, says how much cash there is, and changes nothing", async () => {
    ledger.computeState.mockResolvedValue({ cash: 1000 });

    const attempt = checkInService.submit("u", { income: 4000, expense: 6500 });

    await expect(attempt).rejects.toMatchObject({ statusCode: 422 });
    await expect(attempt).rejects.toThrow(/spend \$2500\.00 more than you earn.*only \$0\.00 in cash saved from before/);
    expect(tx.cashCredit.update).not.toHaveBeenCalled();
    expect(tx.monthlyCheckIn.upsert).not.toHaveBeenCalled();
  });

  it("names the cash saved from before this month, not this month's own credit that is being replaced", async () => {
    ledger.computeState.mockResolvedValue({ cash: 2000 }); // 1600 of it is this month's credit: 400 saved
    await expect(checkInService.submit("u", { income: 4000, expense: 6500 })).rejects.toThrow(/only \$400\.00 in cash saved from before this month/);
  });

  it("explains a refused drop in income (no overspend) in terms of this month's cash", async () => {
    ledger.computeState.mockResolvedValue({ cash: 100 });
    await expect(checkInService.submit("u", { income: 2000, expense: 1800 })).rejects.toThrow(/lower this month's cash by \$1400\.00.*only \$100\.00/);
  });

  it("an income that was not received (zero) is a valid month", async () => {
    ledger.computeState.mockResolvedValue({ cash: 5000 });
    await checkInService.submit("u", { income: 0, expense: 1200 });
    expect(tx.cashCredit.update).toHaveBeenCalledWith({ where: { id: "credit-1" }, data: { amount: -1200, source: "CHECKIN" } });
  });

  it("reporting the month again replaces the earlier report", async () => {
    tx.monthlyCheckIn.findUnique.mockResolvedValue({ income: "4000.00", expense: "6500.00" });
    tx.cashCredit.findUnique.mockResolvedValue({ id: "credit-1", amount: "-2500.00" });
    ledger.computeState.mockResolvedValue({ cash: 100 });

    await checkInService.submit("u", { income: 4000, expense: 2400 }); // back to normal: delta +4100, always fine

    expect(tx.cashCredit.update).toHaveBeenCalledWith({ where: { id: "credit-1" }, data: { amount: 1600, source: "CHECKIN" } });
  });

  it("can also make the figures the usual ones, for a real change such as a new job", async () => {
    await checkInService.submit("u", { income: 5200, expense: 2600, makeUsual: true });
    expect(tx.userProfile.update).toHaveBeenCalledWith({ where: { userId: "u" }, data: { monthlyIncome: 5200, monthlyExpense: 2600 } });
  });

  it("will not make a zero income the usual one", async () => {
    await expect(checkInService.submit("u", { income: 0, expense: 1200, makeUsual: true })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("catches up earlier months at the usual figures before changing this one", async () => {
    const order: string[] = [];
    ledger.advance.mockImplementation(async () => void order.push("advance"));
    tx.cashCredit.update.mockImplementation(async () => void order.push("update credit"));
    await checkInService.submit("u", { income: 4000, expense: 2400 });
    expect(order).toEqual(["advance", "update credit"]);
  });

  it("recomputes the account's stored figures after the change", async () => {
    await checkInService.submit("u", { income: 4000, expense: 2400 });
    expect(ledger.persistDerived).toHaveBeenCalled();
  });

  it("validates the amounts", async () => {
    await expect(checkInService.submit("u", { income: -1, expense: 0 })).rejects.toThrow();
    await expect(checkInService.submit("u", { income: 100, expense: -5 })).rejects.toThrow();
    await expect(checkInService.submit("u", { income: "lots", expense: 5 })).rejects.toThrow();
    await expect(checkInService.submit("u", { income: 100 })).rejects.toThrow();
  });
});
