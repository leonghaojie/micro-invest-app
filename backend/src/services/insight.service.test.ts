/**
 * InsightService — FR12/UC-06 on the cohort engine (DECISIONS.md #32): the "not ready"
 * states and how loaded members become cards. The member loader, Prisma and the plan
 * service are mocked; the card rules themselves are tested in utils/insightCards.test.ts.
 */
import { prisma } from "../config/prisma";
import { Member } from "../utils/peerCohort";
import { insightService } from "./insight.service";
import { loadMembers } from "./memberLoader";
import { planService } from "./plan.service";

jest.mock("../config/prisma", () => ({ prisma: { userProfile: { findUnique: jest.fn() } } }));
jest.mock("./plan.service", () => ({ planService: { getActivePlan: jest.fn() } }));
jest.mock("./memberLoader", () => ({ loadMembers: jest.fn() }));

const profiles = (prisma as unknown as { userProfile: { findUnique: jest.Mock } }).userProfile;
const plans = planService as unknown as { getActivePlan: jest.Mock };
const load = loadMembers as unknown as jest.Mock;

function member(id: string, i: number): Member {
  return {
    id,
    age: 25 + (i % 10),
    income: 3000 + i * 50,
    expense: 2000 + i * 20,
    risk: "MEDIUM",
    contribution: 300,
    consistencyPct: 100,
    value: 1000 + i * 100,
    cash: 500 + i * 40,
    holdings: [{ assetClass: "EQUITY", weight: 1 }],
    monthlyReturns: {},
  };
}

const members = [member("user-1", 20), ...Array.from({ length: 39 }, (_, i) => member(`peer-${i}`, i))];

describe("InsightService.generate", () => {
  beforeEach(() => {
    profiles.findUnique.mockResolvedValue({ userId: "user-1" });
    plans.getActivePlan.mockResolvedValue({ planId: "plan-1" });
    load.mockResolvedValue({ asOf: "2026-09", members, simulated: 30, fundReturns: {} });
  });

  it("asks for a profile first", async () => {
    profiles.findUnique.mockResolvedValue(null);
    expect(await insightService.generate("user-1")).toEqual({ status: "no-profile" });
    expect(load).not.toHaveBeenCalled();
  });

  it("says there is nothing to compare before the account exists", async () => {
    plans.getActivePlan.mockResolvedValue(null);
    expect(await insightService.generate("user-1")).toEqual({ status: "no-plan" });
  });

  it("says there is nothing to compare until the user has invested (is a member)", async () => {
    load.mockResolvedValue({ asOf: "2026-09", members: members.slice(1), simulated: 30, fundReturns: {} });
    expect(await insightService.generate("user-1")).toEqual({ status: "no-plan" });
  });

  it("reports missing fund data", async () => {
    load.mockResolvedValue(null);
    expect(await insightService.generate("user-1")).toEqual({ status: "no-data" });
  });

  it("brings the user's own account up to date before loading everyone", async () => {
    await insightService.generate("user-1");
    expect(plans.getActivePlan).toHaveBeenCalledWith("user-1");
    expect(plans.getActivePlan.mock.invocationCallOrder[0]).toBeLessThan(load.mock.invocationCallOrder[0]);
  });

  it("returns the three cards, the data month and the simulated share", async () => {
    const res = await insightService.generate("user-1");
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.asOf).toBe("2026-09");
    expect(res.simulatedPct).toBe(75);
    expect(res.cards.map((c) => c.key)).toEqual(["value", "savingsRate", "cashBuffer"]);
    expect(res.cards[0]).toMatchObject({ status: "ok", you: 3000, cohortSize: 39 });
    expect(JSON.stringify(res)).not.toMatch(/peer-\d/);
  });
});
