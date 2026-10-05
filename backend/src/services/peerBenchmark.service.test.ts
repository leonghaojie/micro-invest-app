/**
 * PeerBenchmarkService unit tests — FR10/FR11, rewritten for DECISIONS.md
 * #2's income-range peer grouping (25 Aug 2026): no more PeerGroup/
 * PeerGroupStats cache, one $queryRaw call returning all three metrics'
 * percentiles at once. Prisma is mocked (including $queryRaw as a plain
 * jest.fn(), which tagged-template calls invoke like any other function)
 * so these run without a live Postgres connection.
 */
import { prisma } from "../config/prisma";
import { peerBenchmarkService } from "./peerBenchmark.service";
import type { PeerGroupAssignment } from "./peerGrouping.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    userProfile: { findUnique: jest.fn() },
    planMonth: { findFirst: jest.fn(), count: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  $queryRaw: jest.Mock;
  userProfile: { findUnique: jest.Mock };
  planMonth: { findFirst: jest.Mock; count: jest.Mock };
};

const BAND: PeerGroupAssignment = { bandPct: 10, lo: 3600, hi: 4400, memberCount: 12 };
const FLOOR: PeerGroupAssignment = { bandPct: null, lo: 0, hi: Infinity, memberCount: 3 };

const FULL_ROW = {
  memberCount: 5,
  valueP25: "100.00",
  valueP50: "150.50",
  valueP75: "220.00",
  savingsP25: "10.00",
  savingsP50: "20.00",
  savingsP75: "35.00",
  bufferP25: "0.50",
  bufferP50: "1.20",
  bufferP75: "2.00",
};

describe("PeerBenchmarkService", () => {
  describe("computeStats", () => {
    it("converts Postgres numeric strings to numbers across all three metrics", async () => {
      mockedPrisma.$queryRaw.mockResolvedValue([FULL_ROW]);

      const result = await peerBenchmarkService.computeStats("user-1", BAND);

      expect(result).toEqual({
        memberCount: 5,
        value: { p25: 100, p50: 150.5, p75: 220 },
        savingsRatePct: { p25: 10, p50: 20, p75: 35 },
        emergencyBuffer: { p25: 0.5, p50: 1.2, p75: 2 },
      });
    });

    it("returns zeros when the group has no members yet", async () => {
      mockedPrisma.$queryRaw.mockResolvedValue([
        { memberCount: 0, valueP25: null, valueP50: null, valueP75: null, savingsP25: null, savingsP50: null, savingsP75: null, bufferP25: null, bufferP50: null, bufferP75: null },
      ]);

      const result = await peerBenchmarkService.computeStats("user-1", BAND);

      expect(result.memberCount).toBe(0);
      expect(result.value).toEqual({ p25: 0, p50: 0, p75: 0 });
    });

    it("queries without an income range for the floor tier", async () => {
      mockedPrisma.$queryRaw.mockResolvedValue([FULL_ROW]);

      await peerBenchmarkService.computeStats("user-1", FLOOR);

      // The floor-tier SQL branch has no `BETWEEN` clause — a loose smoke
      // check that it still ran (didn't throw) and returned the row.
      expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe("getMyMetrics", () => {
    it("returns nulls when the user has no profile", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue(null);

      const result = await peerBenchmarkService.getMyMetrics("user-1");

      expect(result).toEqual({ finalValue: null, savingsRatePct: 0, emergencyBuffer: null });
    });

    it("computes Savings Rate from the profile even with no plan yet", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({ monthlyIncome: "4000.00", monthlyExpense: "3000.00" });
      mockedPrisma.planMonth.findFirst.mockResolvedValue(null);

      const result = await peerBenchmarkService.getMyMetrics("user-1");

      expect(result).toEqual({ finalValue: null, savingsRatePct: 25, emergencyBuffer: null });
    });

    it("derives finalValue and Emergency Buffer from the latest plan month", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({ monthlyIncome: "4000.00", monthlyExpense: "2000.00" });
      mockedPrisma.planMonth.findFirst.mockResolvedValue({ endingBalance: "1333.37", walletBalance: "3000.00" });
      mockedPrisma.planMonth.count.mockResolvedValue(3);

      const result = await peerBenchmarkService.getMyMetrics("user-1");

      expect(result).toEqual({ finalValue: 1333.37, savingsRatePct: 50, emergencyBuffer: 1.5 });
    });

    it("has no value to compare while the account holds only cash (nothing bought yet)", async () => {
      mockedPrisma.userProfile.findUnique.mockResolvedValue({ monthlyIncome: "4000.00", monthlyExpense: "2000.00" });
      mockedPrisma.planMonth.findFirst.mockResolvedValue({ endingBalance: "0.00", walletBalance: "3000.00" });
      mockedPrisma.planMonth.count.mockResolvedValue(0);

      const result = await peerBenchmarkService.getMyMetrics("user-1");

      expect(result).toEqual({ finalValue: null, savingsRatePct: 50, emergencyBuffer: 1.5 });
    });
  });
});
