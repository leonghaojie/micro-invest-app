/**
 * Segmentation tests for PeerGroupingService.resolveSegment / describeSegment
 * — DECISIONS.md #9. The default income-only path is covered (unchanged) in
 * peerGrouping.service.test.ts; this file covers choosing other dimensions
 * and, above all, the suppression rule: an explicit selection that matches
 * fewer than MIN_GROUP_SIZE peers must yield NO statistics.
 */
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { describeSegment, parsePeerDimensions, peerGroupingService, PeerGroupAssignment } from "./peerGrouping.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    userProfile: { findUnique: jest.fn(), count: jest.fn() },
    plan: { findUnique: jest.fn() },
  },
}));

const db = prisma as unknown as {
  userProfile: { findUnique: jest.Mock; count: jest.Mock };
  plan: { findUnique: jest.Mock };
};

const PROFILE = { monthlyIncome: "4000.00", age: 28, riskLevel: "MEDIUM", goalType: "HABIT" };
const MIN = env.minGroupSize;

beforeEach(() => {
  db.userProfile.findUnique.mockResolvedValue(PROFILE);
});

describe("PeerGroupingService.resolveSegment", () => {
  it("404s when the user has no profile", async () => {
    db.userProfile.findUnique.mockResolvedValue(null);

    await expect(peerGroupingService.resolveSegment("u", ["age"])).rejects.toMatchObject({ statusCode: 404 });
  });

  it("matches age within ±5 years of the user, alongside income", async () => {
    db.userProfile.count.mockResolvedValueOnce(MIN + 5);

    const result = await peerGroupingService.resolveSegment("u", ["income", "age"]);

    expect(result.bandPct).toBe(10);
    expect(result.filters?.age).toEqual({ lo: 23, hi: 33 });
    expect(result.suppressed).toBe(false);
    expect(db.userProfile.count.mock.calls[0][0].where).toMatchObject({
      userId: { not: "u" },
      age: { gte: 23, lte: 33 },
      monthlyIncome: { gte: expect.any(Number), lte: expect.any(Number) },
    });
  });

  it("matches the user's own risk level and goal when selected", async () => {
    db.userProfile.count.mockResolvedValueOnce(MIN);

    const result = await peerGroupingService.resolveSegment("u", ["risk", "goal"]);

    expect(result.filters).toEqual({ riskLevel: "MEDIUM", goalType: "HABIT" });
    expect(db.userProfile.count.mock.calls[0][0].where).toMatchObject({ riskLevel: "MEDIUM", goalType: "HABIT" });
    // income not selected -> a single count, no widening, no income bounds
    expect(db.userProfile.count).toHaveBeenCalledTimes(1);
    expect(db.userProfile.count.mock.calls[0][0].where).not.toHaveProperty("monthlyIncome");
  });

  it("widens only income: other filters stay fixed on every step", async () => {
    db.userProfile.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(MIN);

    const result = await peerGroupingService.resolveSegment("u", ["income", "risk"]);

    expect(result.bandPct).toBe(20);
    for (const call of db.userProfile.count.mock.calls) {
      expect(call[0].where.riskLevel).toBe("MEDIUM");
    }
  });

  it("filters by the user's plan start month", async () => {
    const start = new Date("2026-03-01T00:00:00Z");
    db.plan.findUnique.mockResolvedValue({ startMonth: start });
    db.userProfile.count.mockResolvedValueOnce(MIN);

    const result = await peerGroupingService.resolveSegment("u", ["startMonth"]);

    expect(result.filters?.startMonth).toEqual(start);
    expect(db.userProfile.count.mock.calls[0][0].where.user).toEqual({ plan: { months: { some: { hasPosition: true } }, startMonth: start } });
  });

  it("400s for a start-month comparison when the user has no plan", async () => {
    db.plan.findUnique.mockResolvedValue(null);

    await expect(peerGroupingService.resolveSegment("u", ["startMonth"])).rejects.toMatchObject({ statusCode: 400 });
  });

  describe("suppression (the privacy rule)", () => {
    it("suppresses a no-income selection that matches fewer than MIN_GROUP_SIZE peers", async () => {
      db.userProfile.count.mockResolvedValue(MIN - 1);

      const result = await peerGroupingService.resolveSegment("u", ["risk", "goal"]);

      expect(result.suppressed).toBe(true);
    });

    it("suppresses when widening is exhausted and the filters alone are still too few", async () => {
      db.userProfile.count.mockResolvedValue(3); // every step, and the filters-only count

      const result = await peerGroupingService.resolveSegment("u", ["income", "age", "risk"]);

      expect(result.suppressed).toBe(true);
      expect(result.bandPct).toBeNull();
      expect(db.userProfile.count).toHaveBeenCalledTimes(19 + 1); // 19 widening steps + filters-only
    });

    it("drops the income restriction (not suppressed) if the other filters alone have enough peers", async () => {
      // 19 income-widening steps all short, then the filters-only count is enough.
      for (let i = 0; i < 19; i++) db.userProfile.count.mockResolvedValueOnce(2);
      db.userProfile.count.mockResolvedValueOnce(MIN + 10);

      const result = await peerGroupingService.resolveSegment("u", ["income", "risk"]);

      expect(result.suppressed).toBe(false);
      expect(result.bandPct).toBeNull();
      expect(result.memberCount).toBe(MIN + 10);
    });

    it("never suppresses the default income-only view (it keeps the original floor tier)", async () => {
      db.userProfile.count.mockResolvedValue(1);

      const result = await peerGroupingService.resolveSegment("u", ["income"]);

      expect(result.suppressed).toBe(false);
      expect(result.bandPct).toBeNull();
    });

    it("suppresses an 'all peers' selection if there are fewer than MIN_GROUP_SIZE peers in total", async () => {
      db.userProfile.count.mockResolvedValue(MIN - 1);

      const result = await peerGroupingService.resolveSegment("u", []);

      expect(result.suppressed).toBe(true);
    });
  });
});

describe("describeSegment", () => {
  const base: PeerGroupAssignment = { bandPct: 10, lo: 0, hi: 1, memberCount: 50, dims: ["income"], filters: {}, suppressed: false };

  it("states the suppression without revealing any count", () => {
    const text = describeSegment({ ...base, suppressed: true, memberCount: 4 });

    expect(text).toContain(`Fewer than ${MIN} peers`);
    expect(text).not.toMatch(/\b4\b/);
  });

  it("describes each selected dimension", () => {
    const text = describeSegment({
      ...base,
      dims: ["income", "age", "risk", "goal", "startMonth"],
      filters: { age: { lo: 23, hi: 33 }, riskLevel: "MEDIUM", goalType: "HABIT", startMonth: new Date() },
    });

    expect(text).toContain("within 10%");
    expect(text).toContain("aged 23–33");
    expect(text).toContain("your risk level");
    expect(text).toContain("your goal");
    expect(text).toContain("same month");
  });

  it("flags when the income range had to be widened", () => {
    expect(describeSegment({ ...base, bandPct: 25 })).toMatch(/widened to ±25%/);
    expect(describeSegment({ ...base, bandPct: 10 })).not.toMatch(/widened/);
  });

  it("explains when income couldn't be used to narrow the group", () => {
    expect(describeSegment({ ...base, bandPct: null, dims: ["income", "risk"], filters: { riskLevel: "MEDIUM" } })).toMatch(
      /income wasn't used/
    );
  });

  it("says 'all peers' when no dimension is selected", () => {
    expect(describeSegment({ ...base, dims: [], bandPct: null })).toBe("Compared against all peers.");
  });
});

describe("parsePeerDimensions", () => {
  it("defaults to income only when the parameter is absent", () => {
    expect(parsePeerDimensions(undefined)).toEqual(["income"]);
  });

  it("treats an explicit empty value as 'no dimension' (everyone)", () => {
    expect(parsePeerDimensions("")).toEqual([]);
  });

  it("parses a comma list, trimming spaces and removing duplicates", () => {
    expect(parsePeerDimensions("income, age ,age,risk")).toEqual(["income", "age", "risk"]);
  });

  it("accepts every known dimension", () => {
    expect(parsePeerDimensions("income,age,risk,goal,startMonth")).toHaveLength(5);
  });

  it("rejects an unknown dimension with a 400 naming the valid ones", () => {
    expect(() => parsePeerDimensions("income,salary")).toThrow(/Unknown peer dimension "salary"/);
    try {
      parsePeerDimensions("nope");
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400 });
    }
  });
});
