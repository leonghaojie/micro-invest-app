/**
 * PeerBenchmarkService unit tests — FR10/FR11. Prisma is mocked (including
 * $queryRaw as a plain jest.fn(), which tagged-template calls invoke like
 * any other function) so these run without a live Postgres connection.
 * computeConsistencyScore itself is NOT mocked — these tests exercise the
 * real formula via fake timers to pin "now", same as dashboard.service.
 * test.ts, so the two stay provably in sync.
 */
import { prisma } from "../config/prisma";
import { peerBenchmarkService } from "./peerBenchmark.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    peerGroup: { findFirst: jest.fn(), create: jest.fn() },
    peerGroupStats: { upsert: jest.fn() },
    simulation: { findFirst: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  $queryRaw: jest.Mock;
  peerGroup: { findFirst: jest.Mock; create: jest.Mock };
  peerGroupStats: { upsert: jest.Mock };
  simulation: { findFirst: jest.Mock };
};

const GROUP = { tier: "FULL" as const, riskLevel: "MEDIUM" as const, budgetBand: "B2" as const, goalType: "HABIT" as const };

// computePeerGroupStats fires two $queryRaw calls via Promise.all, in
// source order: [0] value percentiles, [1] per-member activity rows.
function mockQueries(valueRow: object, activityRows: object[]) {
  mockedPrisma.$queryRaw.mockReset();
  mockedPrisma.$queryRaw.mockResolvedValueOnce([valueRow]).mockResolvedValueOnce(activityRows);
}

beforeEach(() => {
  mockedPrisma.peerGroup.findFirst.mockResolvedValue({ id: "pg-1" });
  mockedPrisma.peerGroupStats.upsert.mockResolvedValue({});
});

describe("PeerBenchmarkService", () => {
  describe("computePeerGroupStats", () => {
    it("converts Postgres numeric strings to numbers", async () => {
      mockQueries({ p25: "100.00", p50: "150.50", p75: "220.00", memberCount: 12 }, []);

      const result = await peerBenchmarkService.computePeerGroupStats(GROUP);

      expect(result.p25).toBe(100);
      expect(result.p50).toBe(150.5);
      expect(result.p75).toBe(220);
      expect(result.memberCount).toBe(12);
    });

    it("returns zeros when the group has no members yet (percentiles null)", async () => {
      mockQueries({ p25: null, p50: null, p75: null, memberCount: 0 }, []);

      const result = await peerBenchmarkService.computePeerGroupStats(GROUP);

      expect(result).toEqual({ p25: 0, p50: 0, p75: 0, memberCount: 0, medianConsistency: 0 });
    });

    it("creates the PeerGroup row when none exists yet, then caches stats", async () => {
      mockQueries({ p25: "1", p50: "2", p75: "3", memberCount: 5 }, []);
      mockedPrisma.peerGroup.findFirst.mockResolvedValue(null);
      mockedPrisma.peerGroup.create.mockResolvedValue({ id: "pg-new" });

      await peerBenchmarkService.computePeerGroupStats(GROUP);

      expect(mockedPrisma.peerGroup.create).toHaveBeenCalledWith({
        data: { riskLevel: "MEDIUM", budgetBand: "B2", goalType: "HABIT", tier: "FULL" },
      });
      expect(mockedPrisma.peerGroupStats.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { peerGroupId: "pg-new" } })
      );
    });

    it("reuses an existing PeerGroup row instead of creating a duplicate", async () => {
      mockQueries({ p25: "1", p50: "2", p75: "3", memberCount: 5 }, []);
      mockedPrisma.peerGroup.findFirst.mockResolvedValue({ id: "pg-existing" });

      await peerBenchmarkService.computePeerGroupStats(GROUP);

      expect(mockedPrisma.peerGroup.create).not.toHaveBeenCalled();
    });

    describe("medianConsistency", () => {
      beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-03-31T00:00:00Z"));
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      it("computes the median of each member's own ConsistencyScore", async () => {
        // A: active in March only -> 1/1 * 100 = 100
        // B: active Jan + March (skips Feb) -> 2/3 * 100 = 66.67
        // C: active in Jan only, 3 months elapsed -> 1/3 * 100 = 33.33
        // median of [33.33, 66.67, 100] = 66.67
        mockQueries({ p25: "1", p50: "2", p75: "3", memberCount: 3 }, [
          { userId: "A", createdAt: new Date("2024-03-05T00:00:00Z") },
          { userId: "B", createdAt: new Date("2024-01-10T00:00:00Z") },
          { userId: "B", createdAt: new Date("2024-03-20T00:00:00Z") },
          { userId: "C", createdAt: new Date("2024-01-15T00:00:00Z") },
        ]);

        const result = await peerBenchmarkService.computePeerGroupStats(GROUP);

        expect(result.medianConsistency).toBe(66.67);
      });

      it("persists medianConsistency into the peer_group_stats cache", async () => {
        mockQueries({ p25: "1", p50: "2", p75: "3", memberCount: 1 }, [
          { userId: "A", createdAt: new Date("2024-03-05T00:00:00Z") },
        ]);

        await peerBenchmarkService.computePeerGroupStats(GROUP);

        expect(mockedPrisma.peerGroupStats.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({ medianConsistency: 100 }),
          })
        );
      });
    });
  });

  describe("getLatestFinalValue", () => {
    it("returns null when the user hasn't run a simulation", async () => {
      mockedPrisma.simulation.findFirst.mockResolvedValue(null);

      const result = await peerBenchmarkService.getLatestFinalValue("user-1");

      expect(result).toBeNull();
    });

    it("converts the latest simulation's finalValue to a number", async () => {
      mockedPrisma.simulation.findFirst.mockResolvedValue({ finalValue: "1333.37" });

      const result = await peerBenchmarkService.getLatestFinalValue("user-1");

      expect(result).toBe(1333.37);
    });
  });
});
