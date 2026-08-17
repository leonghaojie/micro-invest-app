/**
 * ProfileService unit tests — FR03. Prisma is mocked so these run without a
 * live Postgres connection.
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
    it("returns the profile when one exists", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({
        id: "profile-1",
        userId: "user-1",
        riskLevel: RiskLevel.MEDIUM,
        goalType: GoalType.HABIT,
        budgetBand: "B2",
      });

      const result = await profileService.getProfile("user-1");

      expect(mockedPrisma.userProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(result).toEqual({ riskLevel: "MEDIUM", goalType: "HABIT", budgetBand: "B2" });
    });

    it("404s when no profile has been set up yet", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(profileService.getProfile("user-1")).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("upsertProfile", () => {
    it.each([
      [49, "B1"],
      [50, "B2"],
      [149, "B2"],
      [150, "B3"],
      [399, "B3"],
      [400, "B4"],
      [10000, "B4"],
    ])("derives budget band %s -> %s", async (monthlyBudget, expectedBand) => {
      mockedPrisma.userProfile.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "profile-1", ...create }));

      const result = await profileService.upsertProfile("user-1", {
        riskLevel: RiskLevel.LOW,
        goalType: GoalType.LEARN,
        monthlyBudget,
      });

      expect(result.budgetBand).toBe(expectedBand);
      expect(mockedPrisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        create: { userId: "user-1", riskLevel: "LOW", goalType: "LEARN", budgetBand: expectedBand },
        update: { riskLevel: "LOW", goalType: "LEARN", budgetBand: expectedBand },
      });
    });

    it("rejects a non-positive budget with a validation error", async () => {
      await expect(
        profileService.upsertProfile("user-1", { riskLevel: RiskLevel.LOW, goalType: GoalType.LEARN, monthlyBudget: 0 })
      ).rejects.toThrow();
      expect(mockedPrisma.userProfile.upsert).not.toHaveBeenCalled();
    });

    it("rejects an invalid enum value", async () => {
      await expect(
        profileService.upsertProfile("user-1", { riskLevel: "EXTREME", goalType: GoalType.LEARN, monthlyBudget: 100 })
      ).rejects.toThrow();
    });
  });
});
