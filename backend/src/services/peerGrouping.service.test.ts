/**
 * PeerGroupingService unit tests — DECISIONS.md #2 rewrite (25 Aug 2026):
 * the ±10%-widening income-range scheme replacing the old FULL/RISK_BUDGET/
 * RISK_ONLY tiers. Prisma is mocked so these run without a live Postgres
 * connection.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { peerGroupingService } from "./peerGrouping.service";

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
  describe("resolveSegment, income only (the Explore default)", () => {
    it("404s when the user has no profile set up", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(peerGroupingService.resolveSegment("user-1", ["income"])).rejects.toMatchObject({ statusCode: 404 });
      expect(mockedPrisma.userProfile.count).not.toHaveBeenCalled();
    });

    it("returns the ±10% band when it already reaches MIN_GROUP_SIZE", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count.mockResolvedValueOnce(env.minGroupSize);

      const result = await peerGroupingService.resolveSegment("user-1", ["income"]);

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

      const result = await peerGroupingService.resolveSegment("user-1", ["income"]);

      expect(result.bandPct).toBe(20);
      expect(mockedPrisma.userProfile.count).toHaveBeenCalledTimes(3);
    });

    it("falls all the way to the floor tier (everyone) if widening never reaches the threshold", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(PROFILE);
      mockedPrisma.userProfile.count.mockResolvedValue(1); // every widening step, still under threshold

      const result = await peerGroupingService.resolveSegment("user-1", ["income"]);

      expect(result.bandPct).toBeNull();
      expect(result.lo).toBe(0);
      expect(result.hi).toBe(Infinity);
      // 19 widening steps (10..100 step 5) + 1 final "everyone" count.
      expect(mockedPrisma.userProfile.count).toHaveBeenCalledTimes(20);
    });
  });
});
