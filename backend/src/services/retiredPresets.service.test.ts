/**
 * Retiring the original single-fund presets (DECISIONS.md #28): monthly buys become the fund
 * itself, duplicates are merged, and the preset goes only when nothing points at it.
 */
import { prisma } from "../config/prisma";
import { backfillLegacyPlans } from "./ledgerBackfill.service";
import { retireLegacyPresets } from "./retiredPresets.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    portfolio: { findMany: jest.fn(), delete: jest.fn() },
    recurringRule: { findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    plan: { count: jest.fn() },
  },
}));
jest.mock("./ledgerBackfill.service", () => ({ backfillLegacyPlans: jest.fn() }));
jest.mock("./ledger.service", () => ({
  getClock: jest.fn(),
  monthDate: (k: string) => new Date(`${k}-01T00:00:00.000Z`),
  monthKey: (d: Date) => d.toISOString().slice(0, 7),
}));
import { getClock } from "./ledger.service";

const db = prisma as unknown as {
  portfolio: { findMany: jest.Mock; delete: jest.Mock };
  recurringRule: { findMany: jest.Mock; update: jest.Mock; delete: jest.Mock; count: jest.Mock };
  plan: { count: jest.Mock };
};
const backfill = backfillLegacyPlans as jest.Mock;
const clock = getClock as jest.Mock;

const preset = (name: string, fundIds: string[] = ["fund-a35"]) => ({ id: `pf-${name}`, name, allocations: fundIds.map((fundId) => ({ fundId })) });
const d = (k: string) => new Date(`${k}-01T00:00:00.000Z`);

beforeEach(() => {
  jest.resetAllMocks();
  backfill.mockResolvedValue({ migrated: 0, skipped: 0 });
  clock.mockResolvedValue({ latestDataMonth: "2026-09", tradeMonth: "2026-10" });
  db.plan.count.mockResolvedValue(0);
  db.recurringRule.count.mockResolvedValue(0);
});

describe("retireLegacyPresets", () => {
  it("does nothing when the presets are already gone (and does not even run the account migration)", async () => {
    db.portfolio.findMany.mockResolvedValue([]);
    expect(await retireLegacyPresets()).toEqual({ rulesConverted: 0, rulesMerged: 0, deleted: [], kept: [] });
    expect(backfill).not.toHaveBeenCalled();
  });

  it("turns a monthly buy of a retired preset into a monthly buy of the fund, then deletes the preset", async () => {
    db.portfolio.findMany.mockResolvedValue([preset("Conservative")]);
    db.recurringRule.findMany.mockImplementation(({ where }: { where: { portfolioId?: string } }) =>
      Promise.resolve(where.portfolioId ? [{ id: "r1", planId: "plan-1", endMonth: null }] : [{ id: "r1", planId: "plan-1", fundId: "fund-a35", amount: "200", startMonth: d("2026-03"), createdAt: d("2026-03") }])
    );

    const result = await retireLegacyPresets();

    expect(db.recurringRule.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { fundId: "fund-a35", portfolioId: null } });
    expect(result).toMatchObject({ rulesConverted: 1, rulesMerged: 0, deleted: ["Conservative"], kept: [] });
    expect(db.portfolio.delete).toHaveBeenCalledWith({ where: { id: "pf-Conservative" } });
  });

  it("runs the migration of old fixed plans first, so none still points at a preset", async () => {
    db.portfolio.findMany.mockResolvedValue([preset("Balanced", ["fund-cfa"])]);
    db.recurringRule.findMany.mockResolvedValue([]);
    await retireLegacyPresets();
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill.mock.invocationCallOrder[0]).toBeLessThan(db.portfolio.delete.mock.invocationCallOrder[0]);
  });

  it("merges two active monthly buys of the same fund: amounts added on the oldest, the other ended last month with its history kept", async () => {
    db.portfolio.findMany.mockResolvedValue([preset("Growth", ["fund-es3"])]);
    db.recurringRule.findMany.mockImplementation(({ where }: { where: { portfolioId?: string } }) =>
      Promise.resolve(
        where.portfolioId
          ? [{ id: "legacy", planId: "plan-1", endMonth: null }]
          : [
              { id: "older", planId: "plan-1", fundId: "fund-es3", amount: "150.00", startMonth: d("2026-01"), createdAt: d("2026-01") },
              { id: "legacy", planId: "plan-1", fundId: "fund-es3", amount: "100.00", startMonth: d("2026-03"), createdAt: d("2026-03") },
            ]
      )
    );

    const result = await retireLegacyPresets();

    expect(db.recurringRule.update).toHaveBeenCalledWith({ where: { id: "older" }, data: { amount: "250.00" } });
    expect(db.recurringRule.update).toHaveBeenCalledWith({ where: { id: "legacy" }, data: { endMonth: d("2026-09") } }); // the month before the trade month
    expect(db.recurringRule.delete).not.toHaveBeenCalled();
    expect(result.rulesMerged).toBe(1);
  });

  it("deletes an extra monthly buy that has not started yet (it never ran), instead of ending it before it began", async () => {
    db.portfolio.findMany.mockResolvedValue([preset("Growth", ["fund-es3"])]);
    db.recurringRule.findMany.mockImplementation(({ where }: { where: { portfolioId?: string } }) =>
      Promise.resolve(
        where.portfolioId
          ? [{ id: "legacy", planId: "plan-1", endMonth: null }]
          : [
              { id: "older", planId: "plan-1", fundId: "fund-es3", amount: "150.00", startMonth: d("2026-01"), createdAt: d("2026-01") },
              { id: "legacy", planId: "plan-1", fundId: "fund-es3", amount: "100.00", startMonth: d("2026-10"), createdAt: d("2026-09") },
            ]
      )
    );
    await retireLegacyPresets();
    expect(db.recurringRule.delete).toHaveBeenCalledWith({ where: { id: "legacy" } });
  });

  it("keeps a preset that something still points at, and says so", async () => {
    db.portfolio.findMany.mockResolvedValue([preset("Conservative")]);
    db.recurringRule.findMany.mockResolvedValue([]);
    db.plan.count.mockResolvedValue(1); // an old plan could not be migrated
    const result = await retireLegacyPresets();
    expect(result).toMatchObject({ deleted: [], kept: ["Conservative"] });
    expect(db.portfolio.delete).not.toHaveBeenCalled();
  });

  it("leaves alone anything that is not exactly one fund", async () => {
    db.portfolio.findMany.mockResolvedValue([preset("Growth", ["a", "b"])]);
    const result = await retireLegacyPresets();
    expect(result).toMatchObject({ deleted: [], kept: ["Growth"] });
    expect(db.recurringRule.update).not.toHaveBeenCalled();
  });

  it("only ever looks for the three retired names among system presets, never a user's custom mix", async () => {
    db.portfolio.findMany.mockResolvedValue([]);
    await retireLegacyPresets();
    expect(db.portfolio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isPreset: true, userId: null, name: { in: ["Conservative", "Balanced", "Growth"] } } })
    );
  });
});
