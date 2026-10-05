/**
 * ProfileService unit tests — FR03, rewritten for DECISIONS.md #1 third
 * amendment (income/expense/age profile, 25 Aug 2026). Prisma is mocked so
 * these run without a live Postgres connection.
 */
import { GoalType, RiskLevel } from "@prisma/client";
import { prisma } from "../config/prisma";
import { profileService } from "./profile.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    userProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  userProfile: { findUnique: jest.Mock; upsert: jest.Mock };
};

describe("ProfileService", () => {
  describe("getProfile", () => {
    it("returns the profile with a derived Savings Rate when one exists", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({
        id: "profile-1",
        userId: "user-1",
        riskLevel: RiskLevel.MEDIUM,
        goalType: GoalType.HABIT,
        monthlyIncome: "4000.00",
        monthlyExpense: "3000.00",
        age: 28,
      });

      const result = await profileService.getProfile("user-1");

      expect(mockedPrisma.userProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(result).toEqual({
        riskLevel: "MEDIUM",
        goalType: "HABIT",
        monthlyIncome: 4000,
        monthlyExpense: 3000,
        age: 28,
        savingsRatePct: 25, // (4000-3000)/4000 * 100
      });
    });

    it("404s when no profile has been set up yet", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(profileService.getProfile("user-1")).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("upsertProfile", () => {
    it("saves the profile and returns the computed Savings Rate", async () => {
      mockedPrisma.userProfile.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "profile-1", ...create }));

      const result = await profileService.upsertProfile("user-1", {
        riskLevel: RiskLevel.LOW,
        goalType: GoalType.LEARN,
        monthlyIncome: 5000,
        monthlyExpense: 2000,
        age: 35,
      });

      expect(result).toEqual({
        riskLevel: "LOW",
        goalType: "LEARN",
        monthlyIncome: 5000,
        monthlyExpense: 2000,
        age: 35,
        savingsRatePct: 60,
      });
      expect(mockedPrisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        create: { userId: "user-1", riskLevel: "LOW", goalType: "LEARN", monthlyIncome: 5000, monthlyExpense: 2000, age: 35 },
        update: { riskLevel: "LOW", goalType: "LEARN", monthlyIncome: 5000, monthlyExpense: 2000, age: 35 },
      });
    });

    it("rejects a non-positive income with a validation error", async () => {
      await expect(
        profileService.upsertProfile("user-1", {
          riskLevel: RiskLevel.LOW,
          goalType: GoalType.LEARN,
          monthlyIncome: 0,
          monthlyExpense: 100,
          age: 30,
        })
      ).rejects.toThrow();
      expect(mockedPrisma.userProfile.upsert).not.toHaveBeenCalled();
    });

    it("rejects a negative expense", async () => {
      await expect(
        profileService.upsertProfile("user-1", {
          riskLevel: RiskLevel.LOW,
          goalType: GoalType.LEARN,
          monthlyIncome: 1000,
          monthlyExpense: -1,
          age: 30,
        })
      ).rejects.toThrow();
    });

    it("rejects an unrealistic age", async () => {
      await expect(
        profileService.upsertProfile("user-1", {
          riskLevel: RiskLevel.LOW,
          goalType: GoalType.LEARN,
          monthlyIncome: 1000,
          monthlyExpense: 100,
          age: 5,
        })
      ).rejects.toThrow();
    });

    it("rejects an invalid enum value", async () => {
      await expect(
        profileService.upsertProfile("user-1", {
          riskLevel: "EXTREME",
          goalType: GoalType.LEARN,
          monthlyIncome: 1000,
          monthlyExpense: 100,
          age: 30,
        })
      ).rejects.toThrow();
    });
  });

  describe("experienceLevel (DECISIONS.md #18)", () => {
    const base = { riskLevel: "MEDIUM", goalType: "GROWTH", monthlyIncome: 4000, monthlyExpense: 2400, age: 28 };

    it("stores a chosen experience level and returns it", async () => {
      mockedPrisma.userProfile.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "p", ...create }));

      const result = await profileService.upsertProfile("user-1", { ...base, experienceLevel: "EXPERIENCED" });

      expect(result.experienceLevel).toBe("EXPERIENCED");
      expect(mockedPrisma.userProfile.upsert.mock.calls[0][0].create.experienceLevel).toBe("EXPERIENCED");
    });

    it("rejects an unknown level", async () => {
      await expect(profileService.upsertProfile("user-1", { ...base, experienceLevel: "EXPERT" })).rejects.toThrow();
    });

    it("leaves it out of the write when the client does not send it, so an update never resets it", async () => {
      mockedPrisma.userProfile.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "p", ...create, experienceLevel: "INTERMEDIATE" }));

      await profileService.upsertProfile("user-1", base);

      const call = mockedPrisma.userProfile.upsert.mock.calls[0][0];
      expect(call.update.experienceLevel).toBeUndefined();
      expect(call.create.experienceLevel).toBeUndefined(); // the database default (BEGINNER) applies on creation
    });
  });
});
