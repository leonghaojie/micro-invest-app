/**
 * ProfileService unit tests — FR03, DECISIONS.md #1 third amendment (income/expense/age
 * profile), #18 (experience) and #19 (creating a profile opens the account; editing income or
 * expenses re-prices only the current month's cash credit). Prisma and the ledger service are
 * mocked so these run without a live Postgres connection.
 */
import { GoalType, RiskLevel } from "@prisma/client";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { advance, computeState, ensureAccount, getClock, lockPlan } from "./ledger.service";
import { profileService } from "./profile.service";

const tx = {
  userProfile: { update: jest.fn() },
  cashCredit: { findUnique: jest.fn(), update: jest.fn() },
};

jest.mock("../config/prisma", () => ({
  prisma: {
    userProfile: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("./ledger.service", () => ({
  advance: jest.fn(),
  computeState: jest.fn(),
  ensureAccount: jest.fn(),
  getClock: jest.fn(),
  lockPlan: jest.fn(),
  monthDate: (m: string) => new Date(`${m}-01T00:00:00.000Z`),
}));

const db = prisma as unknown as {
  userProfile: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};
const ledger = { advance, computeState, ensureAccount, getClock, lockPlan } as unknown as Record<string, jest.Mock>;

const CLOCK = { latestDataMonth: "2026-09", tradeMonth: "2026-10" };
const base = { riskLevel: "MEDIUM", goalType: "GROWTH", monthlyIncome: 4000, monthlyExpense: 2400, age: 28 };
const stored = (over: object = {}) => ({
  id: "p",
  userId: "user-1",
  riskLevel: RiskLevel.MEDIUM,
  goalType: GoalType.GROWTH,
  monthlyIncome: "4000.00",
  monthlyExpense: "2400.00",
  age: 28,
  experienceLevel: "BEGINNER",
  ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  ledger.getClock.mockResolvedValue(CLOCK);
  ledger.ensureAccount.mockResolvedValue({ id: "plan-1" });
  db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
});

describe("ProfileService", () => {
  describe("getProfile", () => {
    it("returns the profile with a derived Savings Rate when one exists", async () => {
      db.userProfile.findUnique.mockResolvedValue({ ...stored(), monthlyExpense: "3000.00" });

      const result = await profileService.getProfile("user-1");

      expect(db.userProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(result).toMatchObject({ riskLevel: "MEDIUM", goalType: "GROWTH", monthlyIncome: 4000, monthlyExpense: 3000, age: 28, savingsRatePct: 25 });
    });

    it("404s when no profile has been set up yet", async () => {
      db.userProfile.findUnique.mockResolvedValue(null);
      await expect(profileService.getProfile("user-1")).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("creating a profile", () => {
    beforeEach(() => {
      db.userProfile.findUnique.mockResolvedValue(null);
      db.userProfile.create.mockImplementation(({ data }) => Promise.resolve({ id: "p", ...data, experienceLevel: data.experienceLevel ?? "BEGINNER" }));
    });

    it("saves it, returns the computed Savings Rate and opens the account for the current trade month", async () => {
      const result = await profileService.upsertProfile("user-1", { ...base, riskLevel: RiskLevel.LOW, goalType: GoalType.LEARN, monthlyIncome: 5000, monthlyExpense: 2000, age: 35 });

      expect(result).toMatchObject({ riskLevel: "LOW", goalType: "LEARN", monthlyIncome: 5000, monthlyExpense: 2000, age: 35, savingsRatePct: 60 });
      expect(db.userProfile.create).toHaveBeenCalledWith({
        data: { userId: "user-1", riskLevel: "LOW", goalType: "LEARN", monthlyIncome: 5000, monthlyExpense: 2000, age: 35 },
      });
      expect(ledger.ensureAccount).toHaveBeenCalledWith(tx, "user-1", CLOCK);
    });

    it("still saves the profile when there is no fund data yet (the account opens on first use)", async () => {
      ledger.getClock.mockRejectedValue(new HttpError(503, "Fund data isn't available yet"));
      const result = await profileService.upsertProfile("user-1", base);
      expect(result.monthlyIncome).toBe(4000);
      expect(ledger.ensureAccount).not.toHaveBeenCalled();
    });

    it("does not hide other failures from opening the account", async () => {
      ledger.ensureAccount.mockRejectedValue(new Error("db down"));
      await expect(profileService.upsertProfile("user-1", base)).rejects.toThrow("db down");
    });

    it("rejects a non-positive income with a validation error", async () => {
      await expect(profileService.upsertProfile("user-1", { ...base, monthlyIncome: 0 })).rejects.toThrow();
      expect(db.userProfile.create).not.toHaveBeenCalled();
    });

    it("rejects a negative expense, an unrealistic age and an invalid enum value", async () => {
      await expect(profileService.upsertProfile("user-1", { ...base, monthlyExpense: -1 })).rejects.toThrow();
      await expect(profileService.upsertProfile("user-1", { ...base, age: 5 })).rejects.toThrow();
      await expect(profileService.upsertProfile("user-1", { ...base, riskLevel: "EXTREME" })).rejects.toThrow();
    });
  });

  describe("editing a profile (DECISIONS.md #19)", () => {
    beforeEach(() => {
      db.userProfile.findUnique.mockResolvedValue(stored());
      tx.userProfile.update.mockImplementation(({ data }) => Promise.resolve(stored(data)));
      tx.cashCredit.findUnique.mockResolvedValue({ id: "credit-1", amount: "1600.00" }); // 4000 - 2400
      ledger.computeState.mockResolvedValue({ cash: 900 });
    });

    it("an edit with no change to income or expenses touches no cash and opens no transaction", async () => {
      db.userProfile.update.mockImplementation(({ data }) => Promise.resolve(stored(data)));

      const result = await profileService.upsertProfile("user-1", { ...base, age: 30, riskLevel: "HIGH" });

      expect(result).toMatchObject({ age: 30, riskLevel: "HIGH" });
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(ledger.advance).not.toHaveBeenCalled();
    });

    it("catches the account up at the OLD figures before the new ones apply", async () => {
      const order: string[] = [];
      ledger.advance.mockImplementation(async () => void order.push("advance"));
      tx.userProfile.update.mockImplementation(({ data }) => {
        order.push("update profile");
        return Promise.resolve(stored(data));
      });

      await profileService.upsertProfile("user-1", { ...base, monthlyIncome: 5000 });

      expect(order).toEqual(["advance", "update profile"]);
      expect(ledger.lockPlan).toHaveBeenCalledWith(tx, "plan-1");
    });

    it("re-prices only the current month's credit to the new spare income", async () => {
      await profileService.upsertProfile("user-1", { ...base, monthlyIncome: 5000 }); // spare 2600, was 1600

      expect(tx.cashCredit.findUnique).toHaveBeenCalledWith({ where: { planId_month: { planId: "plan-1", month: new Date("2026-10-01T00:00:00.000Z") } } });
      expect(tx.cashCredit.update).toHaveBeenCalledWith({ where: { id: "credit-1" }, data: { amount: 2600 } });
    });

    it("lowering expenses raises it too", async () => {
      await profileService.upsertProfile("user-1", { ...base, monthlyExpense: 2000 });
      expect(tx.cashCredit.update).toHaveBeenCalledWith({ where: { id: "credit-1" }, data: { amount: 2000 } });
    });

    it("allows a cut that the remaining cash can absorb", async () => {
      ledger.computeState.mockResolvedValue({ cash: 1200 });
      await profileService.upsertProfile("user-1", { ...base, monthlyIncome: 3000 }); // spare 600: delta -1000 leaves 200
      expect(tx.cashCredit.update).toHaveBeenCalledWith({ where: { id: "credit-1" }, data: { amount: 600 } });
    });

    it("refuses a change that would leave cash below zero, and changes nothing", async () => {
      ledger.computeState.mockResolvedValue({ cash: 300 });

      await expect(profileService.upsertProfile("user-1", { ...base, monthlyIncome: 3000 })).rejects.toMatchObject({ statusCode: 422 });

      expect(tx.cashCredit.update).not.toHaveBeenCalled();
    });

    it("explains the refusal in terms of this month's cash", async () => {
      ledger.computeState.mockResolvedValue({ cash: 300 });
      await expect(profileService.upsertProfile("user-1", { ...base, monthlyIncome: 3000 })).rejects.toThrow(/lower this month's cash by \$1000\.00.*only \$300\.00/);
    });

    it("never touches any other month's credit", async () => {
      await profileService.upsertProfile("user-1", { ...base, monthlyIncome: 5000 });
      expect(tx.cashCredit.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.cashCredit.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("experienceLevel (DECISIONS.md #18)", () => {
    beforeEach(() => {
      db.userProfile.findUnique.mockResolvedValue(null);
      db.userProfile.create.mockImplementation(({ data }) => Promise.resolve({ id: "p", ...data, experienceLevel: data.experienceLevel ?? "BEGINNER" }));
    });

    it("stores a chosen experience level and returns it", async () => {
      const result = await profileService.upsertProfile("user-1", { ...base, experienceLevel: "EXPERIENCED" });
      expect(result.experienceLevel).toBe("EXPERIENCED");
      expect(db.userProfile.create.mock.calls[0][0].data.experienceLevel).toBe("EXPERIENCED");
    });

    it("rejects an unknown level", async () => {
      await expect(profileService.upsertProfile("user-1", { ...base, experienceLevel: "EXPERT" })).rejects.toThrow();
    });

    it("leaves it out of the write when the client does not send it, so an update never resets it", async () => {
      await profileService.upsertProfile("user-1", base);
      expect(db.userProfile.create.mock.calls[0][0].data.experienceLevel).toBeUndefined(); // the database default applies on creation

      db.userProfile.findUnique.mockResolvedValue(stored({ experienceLevel: "INTERMEDIATE" }));
      db.userProfile.update.mockImplementation(({ data }) => Promise.resolve(stored(data)));
      await profileService.upsertProfile("user-1", { ...base, age: 29 });
      expect(db.userProfile.update.mock.calls[0][0].data.experienceLevel).toBeUndefined();
    });
  });
});
