/**
 * PeerGroupingService unit tests — the Lab #4 basis-path target
 * (DECISIONS.md #2): the three fallback branches (FULL / RISK_BUDGET /
 * RISK_ONLY) exercised independently. Prisma is mocked so these run
 * without a live Postgres connection.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { describeTier, peerGroupingService } from "./peerGrouping.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    userProfile: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  userProfile: { findUnique: jest.Mock; count: jest.Mock };
};

const PROFILE = { riskLevel: "MEDIUM", budgetBand: "B2", goalType: "HABIT" };

describe("PeerGroupingService", () => {
  describe("assignPeerGroup", () => {
    it("404s when the user has no profile set up", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(peerGroupingService.assignPeerGroup("user-1")).rejects.toMatchObject({ statusCode: 404 });
      expect(mockedPrisma.userProfile.count).not.toHaveBeenCalled();
    });

    it("returns FULL when the exact-match group already reaches MIN_GROUP_SIZE", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count.mockResolvedValueOnce(env.minGroupSize); // FULL count

      const result = await peerGroupingService.assignPeerGroup("user-1");

      expect(result).toEqual({ tier: "FULL", riskLevel: "MEDIUM", budgetBand: "B2", goalType: "HABIT" });
      expect(mockedPrisma.userProfile.count).toHaveBeenCalledTimes(1);
    });

    it("falls back to RISK_BUDGET when FULL is under threshold but risk+budget reaches it", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count
        .mockResolvedValueOnce(env.minGroupSize - 1) // FULL
        .mockResolvedValueOnce(env.minGroupSize); // RISK_BUDGET

      const result = await peerGroupingService.assignPeerGroup("user-1");

      expect(result).toEqual({ tier: "RISK_BUDGET", riskLevel: "MEDIUM", budgetBand: "B2", goalType: null });
    });

    it("falls all the way back to RISK_ONLY (floor tier) even below threshold", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count
        .mockResolvedValueOnce(0) // FULL
        .mockResolvedValueOnce(2); // RISK_BUDGET, still under MIN_GROUP_SIZE

      const result = await peerGroupingService.assignPeerGroup("user-1");

      expect(result).toEqual({ tier: "RISK_ONLY", riskLevel: "MEDIUM", budgetBand: null, goalType: null });
    });
  });

  describe("describeTier", () => {
    it("flags a small-sample RISK_ONLY group", () => {
      expect(describeTier("RISK_ONLY", 3)).toMatch(/small sample/);
    });

    it("does not flag a small sample once RISK_ONLY itself reaches MIN_GROUP_SIZE", () => {
      expect(describeTier("RISK_ONLY", env.minGroupSize)).not.toMatch(/small sample/);
    });

    it("names the narrowed dimension for RISK_BUDGET", () => {
      expect(describeTier("RISK_BUDGET", env.minGroupSize)).toMatch(/goal/i);
    });
  });
});
