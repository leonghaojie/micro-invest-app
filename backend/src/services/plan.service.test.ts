/**
 * PlanService (DECISIONS.md #19): the account summary. The arithmetic is tested in
 * utils/ledger.test.ts and the database side in ledger.service.test.ts; this checks that the
 * summary is shaped correctly from a derived state.
 */
import { planService } from "./plan.service";
import { refreshAccount } from "./ledger.service";

jest.mock("./ledger.service", () => ({ refreshAccount: jest.fn() }));
const refresh = refreshAccount as unknown as jest.Mock;

const clock = { latestDataMonth: "2026-09", tradeMonth: "2026-10" };

function state(over: object = {}) {
  return {
    points: [
      { month: "2026-08", portfolioReturn: 0, hasPosition: false, netFlow: 0, endingValue: 0, totalInvested: 0, cash: 1600 },
      { month: "2026-09", portfolioReturn: 0.0123456789, hasPosition: true, netFlow: 200, endingValue: 202.47, totalInvested: 200, cash: 2999.5 },
    ],
    holdings: [
      { fundId: "a", value: 150.25, costBasis: 150 },
      { fundId: "b", value: 100.1, costBasis: 100 },
    ],
    cash: 2999.5,
    netInvested: 250,
    firstBuyMonth: "2026-09",
    facts: { credits: [{ month: "2026-08", amount: 1600 }], entries: [{ month: "2026-09", side: "BUY" as const, fundId: "a", amount: 200 }] },
    ...over,
  };
}

describe("PlanService.getActivePlan", () => {
  beforeEach(() => jest.resetAllMocks());

  it("is null for a user without a profile", async () => {
    refresh.mockResolvedValue(null);
    expect(await planService.getActivePlan("u")).toBeNull();
  });

  it("passes the advance option through (reading someone else's account must not change it)", async () => {
    refresh.mockResolvedValue(null);
    await planService.getActivePlan("u", { advance: false });
    expect(refresh).toHaveBeenCalledWith("u", { advance: false });
  });

  it("shapes the derived state into the summary", async () => {
    refresh.mockResolvedValue({ planId: "p1", clock, state: state() });
    const plan = (await planService.getActivePlan("u"))!;

    expect(plan).toMatchObject({
      planId: "p1",
      tradeMonth: "2026-10",
      latestDataMonth: "2026-09",
      startMonth: "2026-09-01", // the first buy, not the account opening
      finalValue: 250.35,
      totalContributed: 250,
      growth: 0.35,
      walletBalance: 2999.5,
    });
    expect(plan.holdings).toEqual([
      { fundId: "a", value: 150.25, costBasis: 150 },
      { fundId: "b", value: 100.1, costBasis: 100 },
    ]);
  });

  it("converts months to the stored shape, with the return rounded to 6 places", async () => {
    refresh.mockResolvedValue({ planId: "p1", clock, state: state() });
    const { months } = (await planService.getActivePlan("u"))!;
    expect(months[1]).toEqual({
      monthDate: "2026-09-01",
      portfolioReturnPct: 0.012346,
      contribution: 200,
      endingBalance: 202.47,
      totalInvested: 200,
      walletBalance: 2999.5,
      hasPosition: true,
    });
    expect(months[0].hasPosition).toBe(false);
  });

  it("reports the typical monthly purchase from the ledger", async () => {
    refresh.mockResolvedValue({ planId: "p1", clock, state: state() });
    // one $200 buy in Sep; the window runs Sep..Oct (the trade month), so $100 a month
    expect((await planService.getActivePlan("u"))!.contributionAmount).toBe(100);
  });

  it("with nothing bought yet: no holdings, the account's opening month, only cash", async () => {
    refresh.mockResolvedValue({
      planId: "p1",
      clock,
      state: state({ points: [], holdings: [], cash: 1600, netInvested: 0, firstBuyMonth: null, facts: { credits: [{ month: "2026-10", amount: 1600 }], entries: [] } }),
    });
    const plan = (await planService.getActivePlan("u"))!;
    expect(plan).toMatchObject({ startMonth: "2026-10-01", finalValue: 0, totalContributed: 0, growth: 0, walletBalance: 1600, contributionAmount: 0, months: [], holdings: [] });
  });
});
