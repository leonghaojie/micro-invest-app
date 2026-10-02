/**
 * PeerGroupingService unit tests — DECISIONS.md #2 rewrite (25 Aug 2026):
 * the ±10%-widening income-range scheme replacing the old FULL/RISK_BUDGET/
 * RISK_ONLY tiers. Prisma is mocked so these run without a live Postgres
 * connection.
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

const PROFILE = { monthlyIncome: "4000.00" };

describe("PeerGroupingService", () => {
  describe("assignPeerGroup", () => {
    it("404s when the user has no profile set up", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(peerGroupingService.assignPeerGroup("user-1")).rejects.toMatchObject({ statusCode: 404 });
      expect(mockedPrisma.userProfile.count).not.toHaveBeenCalled();
    });

    it("returns the ±10% band when it already reaches MIN_GROUP_SIZE", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count.mockResolvedValueOnce(env.minGroupSize);

      const result = await peerGroupingService.assignPeerGroup("user-1");

      expect(result.bandPct).toBe(10);
      expect(result.lo).toBeCloseTo(3600);
      expect(result.hi).toBeCloseTo(4400);
      expect(result.memberCount).toBe(env.minGroupSize);
      expect(mockedPrisma.userProfile.count).toHaveBeenCalledTimes(1);
    });

    it("widens by 5 percentage points per step until the threshold is met", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count
        .mockResolvedValueOnce(2) // ±10%
        .mockResolvedValueOnce(5) // ±15%
        .mockResolvedValueOnce(env.minGroupSize); // ±20%

      const result = await peerGroupingService.assignPeerGroup("user-1");

      expect(result.bandPct).toBe(20);
      expect(mockedPrisma.userProfile.count).toHaveBeenCalledTimes(3);
    });

    it("falls all the way to the floor tier (everyone) if widening never reaches the threshold", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count.mockResolvedValue(1); // every widening step, still under threshold

      const result = await peerGroupingService.assignPeerGroup("user-1");

      expect(result.bandPct).toBeNull();
      expect(result.lo).toBe(0);
      expect(result.hi).toBe(Infinity);
      // 19 widening steps (10..100 step 5) + 1 final "everyone" count.
      expect(mockedPrisma.userProfile.count).toHaveBeenCalledTimes(20);
    });
  });

  describe("describeTier", () => {
    it("names the exact ±10% band on the first match", () => {
      expect(describeTier({ bandPct: 10, lo: 0, hi: 1, memberCount: env.minGroupSize })).toMatch(/within 10%/);
    });

    it("flags that widening was needed for a wider band", () => {
      expect(describeTier({ bandPct: 25, lo: 0, hi: 1, memberCount: env.minGroupSize })).toMatch(/within 25%/);
      expect(describeTier({ bandPct: 25, lo: 0, hi: 1, memberCount: env.minGroupSize })).toMatch(/not enough peers/i);
    });

    it("flags a small-sample floor tier", () => {
      expect(describeTier({ bandPct: null, lo: 0, hi: Infinity, memberCount: 3 })).toMatch(/small sample/);
    });

    it("does not flag a small sample once the floor tier itself reaches MIN_GROUP_SIZE", () => {
      expect(describeTier({ bandPct: null, lo: 0, hi: Infinity, memberCount: env.minGroupSize })).not.toMatch(/small sample/);
    });
  });
});
