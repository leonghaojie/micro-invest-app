/**
 * FriendsService unit tests — DECISIONS.md #8, #22. Two layers:
 *  - pure functions (buildComparison, generateInviteCode), tested directly;
 *  - the service's rules, with Prisma and PlanService mocked so these run
 *    without a live Postgres connection. The privacy properties (sharing
 *    filter, no id/email in responses, non-enumerating add-friend response)
 *    are the point of this feature, so they get explicit tests.
 */
import { prisma } from "../config/prisma";
import { planService } from "./plan.service";
import { loadMembers } from "./memberLoader";
import { Member } from "../utils/peerCohort";
import {
  buildComparison,
  friendsService,
  generateInviteCode,
  GENERIC_REQUEST_RESPONSE,
  MAX_FRIENDS,
  MemberMetrics,
  METRIC_KEYS,
  PortfolioSnapshot,
  SharingSettings,
  summarizeHoldings,
  toMemberHoldings,
} from "./friends.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    friendship: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    friendSharing: { upsert: jest.fn() },
    userProfile: { findMany: jest.fn() },
    plan: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock("./plan.service", () => ({
  planService: { getActivePlan: jest.fn() },
  round2: (v: number) => Math.round(v * 100) / 100,
}));
jest.mock("./memberLoader", () => ({ loadMembers: jest.fn() }));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  friendship: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  friendSharing: { upsert: jest.Mock };
  userProfile: { findMany: jest.Mock };
  plan: { findUnique: jest.Mock; findMany: jest.Mock };
};
const plans = planService as unknown as { getActivePlan: jest.Mock };
const loader = loadMembers as unknown as jest.Mock;

const ALL_ON: SharingSettings = {
  shareInvestmentRate: true,
  shareConsistency: true,
  shareDiversification: true,
  shareReturn: true,
  shareMonthlyReturn: true,
  shareHoldings: true,
};
const ALL_OFF: SharingSettings = {
  shareInvestmentRate: false,
  shareConsistency: false,
  shareDiversification: false,
  shareReturn: false,
  shareMonthlyReturn: false,
  shareHoldings: false,
};

function metrics(overrides: Partial<MemberMetrics> = {}): MemberMetrics {
  return { investmentRate: 8, consistency: 90, diversification: 50, return: 5, monthlyReturn: 0.6, ...overrides };
}

// ── Pure functions ─────────────────────────────────────────────────────

describe("the measures friends rank on (DECISIONS.md #22)", () => {
  it("are exactly the cohort comparison's five, and never the portfolio's value, savings rate or emergency buffer", () => {
    expect([...METRIC_KEYS]).toEqual(["return", "monthlyReturn", "investmentRate", "consistency", "diversification"]);
    const result = buildComparison({ displayName: "Me", metrics: metrics() }, []);
    expect(Object.keys(result.metrics).sort()).toEqual([...METRIC_KEYS].sort());
    const json = JSON.stringify(result);
    for (const gone of ["savings", "emergency", "walletbalance", "portfoliovalue", "totalvalue"]) expect(json.toLowerCase()).not.toContain(gone);
    expect(Object.keys(result.metrics)).not.toContain("value");
  });

  it("offer a sharing switch for each measure and for holdings, and for nothing else", () => {
    expect(Object.keys(ALL_OFF).sort()).toEqual(["shareConsistency", "shareDiversification", "shareHoldings", "shareInvestmentRate", "shareMonthlyReturn", "shareReturn"]);
  });
});

describe("buildComparison", () => {
  it("ranks the user and sharing friends high-to-low", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ investmentRate: 20 }) }, [
      { displayName: "Ann", metrics: metrics({ investmentRate: 30 }), shared: ALL_ON },
      { displayName: "Bob", metrics: metrics({ investmentRate: 10 }), shared: ALL_ON },
    ]);

    expect(result.metrics.investmentRate.rows).toEqual([
      { displayName: "Ann", isMe: false, value: 30, rank: 1 },
      { displayName: "Me", isMe: true, value: 20, rank: 2 },
      { displayName: "Bob", isMe: false, value: 10, rank: 3 },
    ]);
    expect(result.friendCount).toBe(2);
  });

  it("uses competition ranking for ties (shared rank, next rank skipped)", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ consistency: 80 }) }, [
      { displayName: "Ann", metrics: metrics({ consistency: 100 }), shared: ALL_ON },
      { displayName: "Bob", metrics: metrics({ consistency: 80 }), shared: ALL_ON },
      { displayName: "Cy", metrics: metrics({ consistency: 50 }), shared: ALL_ON },
    ]);

    expect(result.metrics.consistency.rows.map((r) => [r.displayName, r.rank])).toEqual([
      ["Ann", 1],
      ["Me", 2],
      ["Bob", 2],
      ["Cy", 4],
    ]);
  });

  it("omits a friend's metric when they haven't shared it, and counts them as hidden without naming them", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ investmentRate: 20, diversification: 30 }) }, [
      { displayName: "Ann", metrics: metrics({ investmentRate: 999, diversification: 99 }), shared: { ...ALL_OFF, shareDiversification: true } },
      { displayName: "Bob", metrics: metrics({ investmentRate: 888, diversification: 88 }), shared: ALL_OFF },
    ]);

    // investment rate: nobody but me shares it
    expect(result.metrics.investmentRate.rows.map((r) => r.displayName)).toEqual(["Me"]);
    expect(result.metrics.investmentRate.hiddenCount).toBe(2);
    expect(JSON.stringify(result.metrics.investmentRate)).not.toContain("999");
    expect(JSON.stringify(result.metrics.investmentRate)).not.toContain("888");

    // diversification: Ann shares, Bob doesn't
    expect(result.metrics.diversification.rows.map((r) => r.displayName)).toEqual(["Ann", "Me"]);
    expect(result.metrics.diversification.hiddenCount).toBe(1);
  });

  it("each measure has its own switch: sharing one never reveals another", () => {
    for (const [key, flag] of [
      ["investmentRate", "shareInvestmentRate"],
      ["consistency", "shareConsistency"],
      ["diversification", "shareDiversification"],
      ["return", "shareReturn"],
      ["monthlyReturn", "shareMonthlyReturn"],
    ] as const) {
      const result = buildComparison({ displayName: "Me", metrics: metrics() }, [{ displayName: "Ann", metrics: metrics(), shared: { ...ALL_OFF, [flag]: true } }]);
      for (const other of METRIC_KEYS) {
        expect(result.metrics[other].rows.some((r) => r.displayName === "Ann")).toBe(other === key);
      }
    }
  });

  it("always shows the user their own figure regardless of any sharing setting", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ investmentRate: 5 }) }, []);

    expect(result.metrics.investmentRate.rows).toEqual([{ displayName: "Me", isMe: true, value: 5, rank: 1 }]);
    expect(result.friendCount).toBe(0);
  });

  it("separates 'shares it but has no figure yet' from 'hides it'", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics() }, [
      { displayName: "Ann", metrics: metrics({ investmentRate: null }), shared: ALL_ON },
    ]);

    expect(result.metrics.investmentRate.noDataCount).toBe(1);
    expect(result.metrics.investmentRate.hiddenCount).toBe(0);
    expect(result.metrics.investmentRate.rows.map((r) => r.displayName)).toEqual(["Me"]);
  });

  it("leaves the user off a board where they have no figure", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ return: null }) }, [
      { displayName: "Ann", metrics: metrics({ return: 10 }), shared: ALL_ON },
    ]);

    expect(result.metrics.return.rows.map((r) => r.displayName)).toEqual(["Ann"]);
  });

  it("carries the number of months the return measures cover", () => {
    expect(buildComparison({ displayName: "Me", metrics: metrics() }, [], 7).windowMonths).toBe(7);
    expect(buildComparison({ displayName: "Me", metrics: metrics() }, []).windowMonths).toBe(0);
  });
});

describe("generateInviteCode", () => {
  it("is 8 characters from the unambiguous alphabet (no I, O, 0, 1)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });
});

// ── Service ────────────────────────────────────────────────────────────

/** Routes prisma.user.findUnique by whichever unique field the service used. */
function mockUsers(rows: { id: string; displayName?: string | null; inviteCode?: string | null; email?: string; isSynthetic?: boolean }[]) {
  db.user.findUnique.mockImplementation(({ where }: { where: { id?: string; inviteCode?: string; email?: string } }) => {
    const row = rows.find(
      (r) =>
        (where.id !== undefined && r.id === where.id) ||
        (where.inviteCode !== undefined && r.inviteCode === where.inviteCode) ||
        (where.email !== undefined && r.email === where.email)
    );
    return Promise.resolve(row ?? null);
  });
}

describe("FriendsService.sendRequest", () => {
  const ME = { id: "me", displayName: "Me", inviteCode: "MYCODE22", email: "me@x.com" };
  const OTHER = { id: "other", displayName: "Other", inviteCode: "OTHRCODE", email: "other@x.com", isSynthetic: false };

  beforeEach(() => {
    db.friendship.count.mockResolvedValue(0);
    db.friendship.findFirst.mockResolvedValue(null);
    db.friendship.create.mockResolvedValue({});
  });

  it("requires a display name first", async () => {
    mockUsers([{ ...ME, displayName: null }, OTHER]);

    await expect(friendsService.sendRequest("me", { code: "OTHRCODE" })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.friendship.create).not.toHaveBeenCalled();
  });

  it("creates a pending request for a valid code", async () => {
    mockUsers([ME, OTHER]);

    const result = await friendsService.sendRequest("me", { code: "othrcode" }); // case-insensitive

    expect(result).toEqual(GENERIC_REQUEST_RESPONSE);
    expect(db.friendship.create).toHaveBeenCalledWith({
      data: { requesterId: "me", addresseeId: "other", status: "PENDING", respondedAt: null },
    });
  });

  it("also works by exact email", async () => {
    mockUsers([ME, OTHER]);

    await friendsService.sendRequest("me", { email: "Other@X.com" }); // normalised to lower-case

    expect(db.friendship.create).toHaveBeenCalled();
  });

  it("returns the identical response for an unknown code, an unknown email and a real target (no enumeration)", async () => {
    mockUsers([ME, OTHER]);

    const real = await friendsService.sendRequest("me", { code: "OTHRCODE" });
    const unknownCode = await friendsService.sendRequest("me", { code: "NOPE2222" });
    const unknownEmail = await friendsService.sendRequest("me", { email: "ghost@x.com" });

    expect(unknownCode).toEqual(real);
    expect(unknownEmail).toEqual(real);
    expect(db.friendship.create).toHaveBeenCalledTimes(1); // only the real one
  });

  it("rejects adding yourself", async () => {
    mockUsers([ME]);

    await expect(friendsService.sendRequest("me", { code: "MYCODE22" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("silently ignores a duplicate request in either direction (same response, nothing created)", async () => {
    mockUsers([ME, OTHER]);
    db.friendship.findFirst.mockResolvedValue({ id: "f1", requesterId: "me", addresseeId: "other", status: "PENDING" });

    const result = await friendsService.sendRequest("me", { code: "OTHRCODE" });

    expect(result).toEqual(GENERIC_REQUEST_RESPONSE);
    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.friendship.update).not.toHaveBeenCalled();
  });

  it("completes the link when the other person had already requested you", async () => {
    mockUsers([ME, OTHER]);
    db.friendship.findFirst.mockResolvedValue({ id: "f1", requesterId: "other", addresseeId: "me", status: "PENDING" });

    await friendsService.sendRequest("me", { code: "OTHRCODE" });

    expect(db.friendship.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { status: "ACCEPTED", respondedAt: expect.any(Date) },
    });
    expect(db.friendship.create).not.toHaveBeenCalled();
  });

  it("auto-accepts a request to a synthetic (seeded demo) user", async () => {
    mockUsers([ME, { ...OTHER, isSynthetic: true }]);

    await friendsService.sendRequest("me", { code: "OTHRCODE" });

    expect(db.friendship.create).toHaveBeenCalledWith({
      data: { requesterId: "me", addresseeId: "other", status: "ACCEPTED", respondedAt: expect.any(Date) },
    });
  });

  it(`enforces the ${MAX_FRIENDS}-friend cap`, async () => {
    mockUsers([ME, OTHER]);
    db.friendship.count.mockResolvedValue(MAX_FRIENDS);

    await expect(friendsService.sendRequest("me", { code: "OTHRCODE" })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.friendship.create).not.toHaveBeenCalled();
  });

  it("requires exactly one of code or email", async () => {
    mockUsers([ME, OTHER]);

    await expect(friendsService.sendRequest("me", {})).rejects.toThrow();
    await expect(friendsService.sendRequest("me", { code: "OTHRCODE", email: "other@x.com" })).rejects.toThrow();
  });
});

describe("FriendsService.acceptRequest / removeFriendship", () => {
  beforeEach(() => {
    mockUsers([{ id: "me", displayName: "Me" }]);
    db.friendship.count.mockResolvedValue(0);
  });

  it("lets only the addressee accept a pending request", async () => {
    db.friendship.findUnique.mockResolvedValue({ id: "f1", requesterId: "other", addresseeId: "me", status: "PENDING" });

    await friendsService.acceptRequest("me", "f1");

    expect(db.friendship.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { status: "ACCEPTED", respondedAt: expect.any(Date) },
    });
  });

  it("404s if the requester tries to accept their own request, or it's already accepted, or it doesn't exist", async () => {
    db.friendship.findUnique.mockResolvedValue({ id: "f1", requesterId: "me", addresseeId: "other", status: "PENDING" });
    await expect(friendsService.acceptRequest("me", "f1")).rejects.toMatchObject({ statusCode: 404 });

    db.friendship.findUnique.mockResolvedValue({ id: "f1", requesterId: "other", addresseeId: "me", status: "ACCEPTED" });
    await expect(friendsService.acceptRequest("me", "f1")).rejects.toMatchObject({ statusCode: 404 });

    db.friendship.findUnique.mockResolvedValue(null);
    await expect(friendsService.acceptRequest("me", "nope")).rejects.toMatchObject({ statusCode: 404 });
    expect(db.friendship.update).not.toHaveBeenCalled();
  });

  it("requires a display name to accept", async () => {
    mockUsers([{ id: "me", displayName: null }]);

    await expect(friendsService.acceptRequest("me", "f1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("lets either participant delete a link, and nobody else", async () => {
    db.friendship.findUnique.mockResolvedValue({ id: "f1", requesterId: "other", addresseeId: "me", status: "ACCEPTED" });
    await friendsService.removeFriendship("me", "f1");
    expect(db.friendship.delete).toHaveBeenCalledWith({ where: { id: "f1" } });

    db.friendship.delete.mockClear();
    db.friendship.findUnique.mockResolvedValue({ id: "f2", requesterId: "a", addresseeId: "b", status: "ACCEPTED" });
    await expect(friendsService.removeFriendship("me", "f2")).rejects.toMatchObject({ statusCode: 404 });
    expect(db.friendship.delete).not.toHaveBeenCalled();
  });
});

describe("FriendsService.getOverview", () => {
  it("returns the existing invite code without generating a new one", async () => {
    db.user.findUnique.mockResolvedValue({ inviteCode: "EXISTING", displayName: "Me", sharing: null });
    db.friendship.findMany.mockResolvedValue([]);

    const overview = await friendsService.getOverview("me");

    expect(overview.inviteCode).toBe("EXISTING");
    expect(db.user.update).not.toHaveBeenCalled();
    expect(overview.sharing).toEqual(ALL_OFF); // privacy by default
  });

  it("lazily creates an invite code for a user who has none", async () => {
    db.user.findUnique.mockResolvedValue({ inviteCode: null, displayName: "Me", sharing: null });
    db.user.update.mockResolvedValue({});
    db.friendship.findMany.mockResolvedValue([]);

    const overview = await friendsService.getOverview("me");

    expect(overview.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "me" }, data: { inviteCode: overview.inviteCode } });
  });

  it("lists friends and incoming requests, never outgoing ones, and exposes no user ids or emails", async () => {
    db.user.findUnique.mockResolvedValue({ inviteCode: "EXISTING", displayName: "Me", sharing: null });
    db.friendship.findMany.mockResolvedValue([
      { id: "f-friend", requesterId: "me", addresseeId: "u-ann", status: "ACCEPTED", requester: { displayName: "Me" }, addressee: { displayName: "Ann" } },
      { id: "f-in", requesterId: "u-bob", addresseeId: "me", status: "PENDING", requester: { displayName: "Bob" }, addressee: { displayName: "Me" } },
      { id: "f-out", requesterId: "me", addresseeId: "u-cy", status: "PENDING", requester: { displayName: "Me" }, addressee: { displayName: "Cy" } },
    ]);

    const overview = await friendsService.getOverview("me");

    expect(overview.friends).toEqual([{ friendshipId: "f-friend", displayName: "Ann" }]);
    expect(overview.incomingRequests).toEqual([{ friendshipId: "f-in", displayName: "Bob" }]);
    const json = JSON.stringify(overview);
    expect(json).not.toContain("Cy"); // outgoing request must not be revealed
    expect(json).not.toContain("u-ann");
    expect(json).not.toContain("u-bob");
    expect(json).not.toContain("u-cy");
  });
});

describe("FriendsService.updateSettings", () => {
  it("saves a trimmed display name and the toggles", async () => {
    db.user.update.mockResolvedValue({});
    db.friendSharing.upsert.mockResolvedValue({ ...ALL_OFF, shareInvestmentRate: true });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });

    const result = await friendsService.updateSettings("me", { displayName: "  Hao  ", shareInvestmentRate: true });

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "me" }, data: { displayName: "Hao" } });
    expect(db.friendSharing.upsert).toHaveBeenCalledWith({
      where: { userId: "me" },
      create: { userId: "me", shareInvestmentRate: true },
      update: { shareInvestmentRate: true },
    });
    expect(result.sharing.shareInvestmentRate).toBe(true);
    expect(result.sharing.shareConsistency).toBe(false);
  });

  it("saves each new measure's switch, independently", async () => {
    db.friendSharing.upsert.mockResolvedValue({ ...ALL_OFF });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });
    await friendsService.updateSettings("me", { shareConsistency: true, shareDiversification: true, shareMonthlyReturn: true, shareReturn: false });
    expect(db.friendSharing.upsert).toHaveBeenCalledWith({
      where: { userId: "me" },
      create: { userId: "me", shareConsistency: true, shareDiversification: true, shareMonthlyReturn: true, shareReturn: false },
      update: { shareConsistency: true, shareDiversification: true, shareMonthlyReturn: true, shareReturn: false },
    });
  });

  it("ignores the removed switches (value, savings rate, emergency buffer): they can no longer be stored", async () => {
    db.friendSharing.upsert.mockResolvedValue({ ...ALL_OFF });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });
    db.friendSharing.upsert.mockClear();
    await friendsService.updateSettings("me", { shareValue: true, shareSavingsRate: true, shareEmergencyBuffer: true, shareContributionRate: true, shareReturnPerRisk: true });
    expect(JSON.stringify(db.friendSharing.upsert.mock.calls)).not.toMatch(/shareValue|shareSavingsRate|shareEmergencyBuffer|shareContributionRate|shareReturnPerRisk/);
  });

  it("saves the holdings toggle on its own, and it defaults to off", async () => {
    db.friendSharing.upsert.mockResolvedValue({ ...ALL_OFF, shareHoldings: true });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });

    const result = await friendsService.updateSettings("me", { shareHoldings: true });

    expect(db.friendSharing.upsert).toHaveBeenCalledWith({
      where: { userId: "me" },
      create: { userId: "me", shareHoldings: true },
      update: { shareHoldings: true },
    });
    expect(result.sharing.shareHoldings).toBe(true);
    expect(result.sharing.shareReturn).toBe(false); // the metric toggles are independent
  });

  it("rejects a non-boolean holdings flag", async () => {
    await expect(friendsService.updateSettings("me", { shareHoldings: "yes" })).rejects.toThrow();
  });

  it("rejects an empty or over-long display name", async () => {
    await expect(friendsService.updateSettings("me", { displayName: "   " })).rejects.toThrow();
    await expect(friendsService.updateSettings("me", { displayName: "x".repeat(31) })).rejects.toThrow();
  });
});

describe("FriendsService.getComparison", () => {
  const ASOF = "2026-09";
  const MONTHS = ["2026-07", "2026-08", "2026-09"];

  /** An investor with returns for `months` (default the last three). */
  function member(id: string, over: Partial<Member> = {}, months: string[] = MONTHS): Member {
    return {
      id,
      age: 28,
      income: 4000,
      expense: 2400,
      risk: "MEDIUM",
      contribution: 400,
      consistencyPct: 90,
      value: 987654,
      holdings: [
        { assetClass: "EQUITY", weight: 0.6 },
        { assetClass: "BOND", weight: 0.4 },
      ],
      monthlyReturns: Object.fromEntries(months.map((m) => [m, 0.01])),
      ...over,
    };
  }

  function arrange(members: Member[], asOf: string | null = ASOF) {
    loader.mockResolvedValue(asOf ? { asOf, members, simulated: 0, fundReturns: {} } : null);
  }

  beforeEach(() => {
    plans.getActivePlan.mockResolvedValue({});
    db.friendship.findMany.mockResolvedValue([
      { requesterId: "me", addresseeId: "u-ann" },
      { requesterId: "u-bob", addresseeId: "me" },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: "me", displayName: "Me", sharing: null },
      { id: "u-ann", displayName: "Ann", sharing: { ...ALL_ON } },
      { id: "u-bob", displayName: "Bob", sharing: { ...ALL_OFF, shareInvestmentRate: true } },
    ]);
  });

  it("ranks accepted friends on the cohort measures, applies each friend's sharing choices, and leaks no ids or emails", async () => {
    arrange([
      member("me", { contribution: 400, consistencyPct: 80 }),
      member("u-ann", { contribution: 800, consistencyPct: 100 }),
      member("u-bob", { contribution: 200, consistencyPct: 60 }),
    ]);

    const result = await friendsService.getComparison("me");

    // investment rate (contribution / income): all three share/see it
    expect(result.metrics.investmentRate.rows.map((r) => [r.displayName, r.value, r.rank])).toEqual([
      ["Ann", 20, 1],
      ["Me", 10, 2],
      ["Bob", 5, 3],
    ]);
    // consistency: Bob shares only the investment rate, so he is absent here
    expect(result.metrics.consistency.rows.map((r) => [r.displayName, r.value])).toEqual([
      ["Ann", 100],
      ["Me", 80],
    ]);
    expect(result.metrics.consistency.hiddenCount).toBe(1);

    const json = JSON.stringify(result);
    for (const secret of ["u-ann", "u-bob", "@", "987654"]) expect(json).not.toContain(secret);
  });

  it("works every measure out with the cohort's own logic: diversification, return and the latest month's return", async () => {
    arrange([member("me"), member("u-ann", { holdings: [{ assetClass: "EQUITY", weight: 1 }] }), member("u-bob")]);

    const result = await friendsService.getComparison("me");

    expect(result.windowMonths).toBe(3);
    // a single holding scores 0 on diversification; the 60/40 mix scores higher
    const div = Object.fromEntries(result.metrics.diversification.rows.map((r) => [r.displayName, r.value]));
    expect(div.Ann).toBe(0);
    expect(div.Me).toBeGreaterThan(0);
    // three months of +1% compound to 3.03%
    expect(result.metrics.return.rows.find((r) => r.isMe)!.value).toBe(3.03);
    // the latest month: +1%
    expect(result.metrics.monthlyReturn.rows.find((r) => r.isMe)!.value).toBe(1);
  });

  it("measures friends over the viewer's months: a friend without those months cannot be ranked on return", async () => {
    arrange([member("me"), member("u-ann", {}, ["2026-09"]), member("u-bob")]);

    const result = await friendsService.getComparison("me");

    expect(result.metrics.return.rows.map((r) => r.displayName).sort()).toEqual(["Me"]);
    expect(result.metrics.return.noDataCount).toBe(1); // Ann shares it but cannot be measured over the same months
    expect(result.metrics.investmentRate.rows.map((r) => r.displayName).sort()).toEqual(["Ann", "Bob", "Me"]); // other measures are unaffected
  });

  it("treats a friend who has not invested as having no figures instead of failing", async () => {
    arrange([member("me")]); // Ann and Bob have no holdings or returns: not members

    const result = await friendsService.getComparison("me");

    expect(result.metrics.investmentRate.rows.map((r) => r.displayName)).toEqual(["Me"]);
    expect(result.metrics.consistency.noDataCount).toBe(1); // Ann shares it, has nothing to show
    expect(result.metrics.consistency.hiddenCount).toBe(1); // Bob does not share it
  });

  it("brings only the viewer's own account up to date and reads friends' as stored", async () => {
    arrange([member("me")]);
    await friendsService.getComparison("me");
    expect(plans.getActivePlan).toHaveBeenCalledTimes(1);
    expect(plans.getActivePlan).toHaveBeenCalledWith("me");
    expect(loader).toHaveBeenCalledWith(["me", "u-ann", "u-bob"]);
  });

  it("handles a user with no friends", async () => {
    db.friendship.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([{ id: "me", displayName: "Me", sharing: null }]);
    arrange([member("me")]);

    const result = await friendsService.getComparison("me");

    expect(result.friendCount).toBe(0);
    expect(result.metrics.investmentRate.rows).toEqual([{ displayName: "Me", isMe: true, value: 10, rank: 1 }]);
  });

  it("handles a user who has not invested yet: no boards of their own, friends still counted", async () => {
    arrange([member("u-ann")]);
    const result = await friendsService.getComparison("me");
    expect(result.windowMonths).toBe(0);
    expect(result.metrics.investmentRate.rows.map((r) => r.displayName)).toEqual(["Ann"]);
  });

  it("copes with no fund data at all", async () => {
    arrange([], null);
    const result = await friendsService.getComparison("me");
    expect(result.friendCount).toBe(2);
    for (const key of METRIC_KEYS) expect(result.metrics[key].rows).toEqual([]);
  });
});

// -- Holdings (DECISIONS.md #12) ----------------------------------------

const fund = (ticker: string, assetClass = "EQUITY") => ({ ticker, name: `${ticker} Fund`, assetClass });

function portfolio(over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    name: "Balanced",
    isPreset: true,
    allocations: [
      { weightPct: 30, fund: fund("A35", "BOND") },
      { weightPct: 50, fund: fund("ES3") },
      { weightPct: 20, fund: fund("G3B") },
    ],
    ...over,
  };
}

describe("toMemberHoldings", () => {
  it("lists holdings largest first and marks the funds the viewer also holds", () => {
    const result = toMemberHoldings("Ann", portfolio(), new Set(["ES3", "ZZZ"]));

    expect(result.holdings.map((h) => [h.ticker, h.weightPct, h.youHold])).toEqual([
      ["ES3", 50, true],
      ["A35", 30, false],
      ["G3B", 20, false],
    ]);
  });

  it("breaks weight ties by ticker so the order is stable", () => {
    const tied = portfolio({ allocations: [{ weightPct: 50, fund: fund("ZZZ") }, { weightPct: 50, fund: fund("AAA") }] });
    expect(toMemberHoldings("Ann", tied, new Set()).holdings.map((h) => h.ticker)).toEqual(["AAA", "ZZZ"]);
  });

  it("shows a preset's name but never a custom portfolio's (free text the owner typed)", () => {
    expect(toMemberHoldings("Ann", portfolio(), new Set()).portfolioName).toBe("Balanced");
    expect(toMemberHoldings("Ann", portfolio({ name: "Baby's college fund", isPreset: false }), new Set()).portfolioName).toBeNull();
  });
});

describe("summarizeHoldings", () => {
  const member = toMemberHoldings(
    "Ann",
    portfolio({
      allocations: [
        { weightPct: 30, fund: fund("A35", "BOND") },
        { weightPct: 25, fund: fund("ES3") },
        { weightPct: 25, fund: fund("G3B") },
        { weightPct: 20, fund: fund("SPY") },
      ],
    }),
    new Set(["ES3", "SPY"])
  );

  it("counts funds, sums weight per asset class (largest first) and counts funds the viewer also holds", () => {
    const summary = summarizeHoldings(member, "fs-1");

    expect(summary).toMatchObject({ friendshipId: "fs-1", displayName: "Ann", portfolioName: "Balanced", fundCount: 4, sharedFundCount: 2 });
    expect(summary.mix).toEqual([
      { assetClass: "EQUITY", pct: 70 },
      { assetClass: "BOND", pct: 30 },
    ]);
  });

  it("carries no fund list (that is fetched per person, so a long list stays small)", () => {
    expect(JSON.stringify(summarizeHoldings(member, "fs-1"))).not.toContain("ES3");
  });

  it("reports no shared funds for the viewer's own row", () => {
    expect(summarizeHoldings(member, null)).toMatchObject({ friendshipId: null, sharedFundCount: 0 });
  });
});

describe("FriendsService.getHoldings (friends list)", () => {
  // An account's holdings (DECISIONS.md #19): one row per fund, with its current value. The
  // name/preset arguments are what the old fixed plan carried; accounts no longer have them.
  const dbPortfolio = (_name: string, _isPreset: boolean, rows: [string, string, number][]) =>
    rows.map(([ticker, assetClass, w]) => ({ value: String(w), fund: fund(ticker, assetClass) }));

  function arrange(opts: { sharing: Record<string, boolean | null>; plans: Record<string, ReturnType<typeof dbPortfolio> | null> }) {
    const ids = Object.keys(opts.sharing);
    db.friendship.findMany.mockResolvedValue(ids.map((id, i) => ({ id: `fs-${i}`, requesterId: "me", addresseeId: id })));
    db.user.findMany.mockResolvedValue(
      ids.map((id) => ({
        id,
        displayName: id.replace("u-", "").replace(/^./, (c) => c.toUpperCase()),
        sharing: opts.sharing[id] === null ? null : { shareHoldings: opts.sharing[id] },
      }))
    );
    db.user.findUnique.mockResolvedValue({ displayName: "Me" });
    db.plan.findUnique.mockResolvedValue(opts.plans.me ? { userId: "me", holdings: opts.plans.me } : null);
    db.plan.findMany.mockImplementation(({ where }: { where: { userId: { in: string[] } } }) =>
      Promise.resolve(where.userId.in.filter((id) => opts.plans[id]).map((id) => ({ userId: id, holdings: opts.plans[id] })))
    );
  }

  it("lists only friends who opted in, counts the rest without naming them, and leaks no ids, emails, amounts or custom names", async () => {
    arrange({
      sharing: { "u-ann": true, "u-bob": false, "u-cat": null },
      plans: {
        me: dbPortfolio("Growth", true, [["ES3", "EQUITY", 100]]),
        "u-ann": dbPortfolio("Balanced", true, [["ES3", "EQUITY", 60], ["A35", "BOND", 40]]),
        "u-bob": dbPortfolio("Bob secret", false, [["G3B", "EQUITY", 100]]),
        "u-cat": dbPortfolio("Cat secret", false, [["G3B", "EQUITY", 100]]),
      },
    });

    const result = await friendsService.getHoldings("me");

    expect(result.friendCount).toBe(3);
    expect(result.friends.map((f) => f.displayName)).toEqual(["Ann"]);
    expect(result.hiddenCount).toBe(2);
    expect(result.noPlanCount).toBe(0);

    const json = JSON.stringify(result);
    for (const secret of ["u-ann", "u-bob", "u-cat", "@", "secret", "contribution", "amount"]) {
      expect(json).not.toContain(secret);
    }
    // a private friend's plan is never even fetched
    expect(db.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: { in: ["u-ann"] } } }));
  });

  it("gives each friend a friendship handle (never a user id) and a summary, not the fund list", async () => {
    arrange({
      sharing: { "u-ann": true },
      plans: {
        me: dbPortfolio("Custom", false, [["ES3", "EQUITY", 100]]),
        "u-ann": dbPortfolio("Balanced", true, [["ES3", "EQUITY", 60], ["A35", "BOND", 40]]),
      },
    });

    const [ann] = (await friendsService.getHoldings("me")).friends;

    expect(ann).toEqual({
      friendshipId: "fs-0",
      displayName: "Ann",
      portfolioName: null,
      fundCount: 2,
      sharedFundCount: 1,
      mix: [
        { assetClass: "EQUITY", pct: 60 },
        { assetClass: "BOND", pct: 40 },
      ],
    });
  });

  it("always includes the viewer's own summary, even when they share nothing", async () => {
    arrange({ sharing: { "u-ann": false }, plans: { me: dbPortfolio("Growth", true, [["ES3", "EQUITY", 100]]) } });

    const result = await friendsService.getHoldings("me");

    expect(result.me).toMatchObject({ displayName: "Me", portfolioName: null, friendshipId: null, fundCount: 1 });
    expect(result.friends).toEqual([]);
    expect(result.hiddenCount).toBe(1);
    expect(db.plan.findMany).not.toHaveBeenCalled(); // nobody shared, so no friend plans are read
  });

  it("counts a sharing friend with no plan yet, instead of naming them or failing", async () => {
    arrange({ sharing: { "u-ann": true }, plans: { me: null, "u-ann": null } });

    const result = await friendsService.getHoldings("me");

    expect(result.me).toBeNull();
    expect(result.friends).toEqual([]);
    expect(result.noPlanCount).toBe(1);
    expect(result.hiddenCount).toBe(0);
  });

  it("handles a user with no friends without querying for an empty id list", async () => {
    db.friendship.findMany.mockResolvedValue([]);
    db.user.findUnique.mockResolvedValue({ displayName: "Me" });
    db.plan.findUnique.mockResolvedValue(null);

    const result = await friendsService.getHoldings("me");

    expect(result).toEqual({ friendCount: 0, me: null, friends: [], hiddenCount: 0, noPlanCount: 0 });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.plan.findMany).not.toHaveBeenCalled();
  });

  it("stops listing a friend the moment they switch it off (nothing is cached)", async () => {
    const plans = { "u-ann": dbPortfolio("Balanced", true, [["ES3", "EQUITY", 100]]), me: null };

    arrange({ sharing: { "u-ann": true }, plans });
    expect((await friendsService.getHoldings("me")).friends).toHaveLength(1);

    arrange({ sharing: { "u-ann": false }, plans });
    const after = await friendsService.getHoldings("me");
    expect(after.friends).toHaveLength(0);
    expect(after.hiddenCount).toBe(1);
  });

  it("stays small for a long friends list (one summary row each, no per-fund payload)", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `u-f${String(i).padStart(2, "0")}`);
    const manyFunds = Array.from({ length: 60 }, (_, i): [string, string, number] => [`T${i}`, "EQUITY", 100 / 60]);
    arrange({
      sharing: Object.fromEntries(ids.map((id) => [id, true])),
      plans: { me: null, ...Object.fromEntries(ids.map((id) => [id, dbPortfolio("Custom", false, manyFunds)])) },
    });

    const result = await friendsService.getHoldings("me");

    expect(result.friends).toHaveLength(50);
    expect(result.friends[0].fundCount).toBe(60);
    expect(JSON.stringify(result)).not.toContain("T59"); // no fund list anywhere in the overview
  });
});

describe("FriendsService.getHoldingsDetail", () => {
  const portfolioRow = (rows: [string, string, number][], _name = "Balanced", _isPreset = true) =>
    rows.map(([ticker, assetClass, w]) => ({ value: String(w), fund: fund(ticker, assetClass) }));

  function arrange(over: {
    link?: { requesterId: string; addresseeId: string; status: "ACCEPTED" | "PENDING" } | null;
    friendSharing?: { shareHoldings: boolean } | null;
    friendPlan?: ReturnType<typeof portfolioRow> | null;
    myPlan?: ReturnType<typeof portfolioRow> | null;
  }) {
    db.friendship.findUnique.mockResolvedValue("link" in over ? over.link : { requesterId: "me", addresseeId: "u-ann", status: "ACCEPTED" });
    db.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === "me"
          ? { displayName: "Me" }
          : { displayName: "Ann", sharing: "friendSharing" in over ? over.friendSharing : { shareHoldings: true } }
      )
    );
    db.plan.findUnique.mockImplementation(({ where }: { where: { userId: string } }) => {
      const p = where.userId === "me" ? ("myPlan" in over ? over.myPlan : portfolioRow([["ES3", "EQUITY", 100]], "Growth")) : "friendPlan" in over ? over.friendPlan : portfolioRow([["ES3", "EQUITY", 60], ["A35", "BOND", 40]]);
      return Promise.resolve(p ? { userId: where.userId, holdings: p } : null);
    });
  }

  const NOT_AVAILABLE = { statusCode: 404, message: "Holdings not available" };

  it("returns the full holdings, largest first, with the funds the viewer also holds marked", async () => {
    arrange({});

    const result = await friendsService.getHoldingsDetail("me", "fs-1");

    expect(result.displayName).toBe("Ann");
    expect(result.portfolioName).toBeNull(); // an account has no single portfolio any more
    expect(result.holdings.map((h) => [h.ticker, h.weightPct, h.youHold])).toEqual([
      ["ES3", 60, true],
      ["A35", 40, false],
    ]);
  });

  it("works when the viewer is the addressee, not the requester", async () => {
    arrange({ link: { requesterId: "u-ann", addresseeId: "me", status: "ACCEPTED" } });
    await expect(friendsService.getHoldingsDetail("me", "fs-1")).resolves.toMatchObject({ displayName: "Ann" });
  });

  it("shows each fund's share of the account's value, not amounts", async () => {
    arrange({ friendPlan: portfolioRow([["ES3", "EQUITY", 3000], ["A35", "BOND", 1000]]) });
    const result = await friendsService.getHoldingsDetail("me", "fs-1");
    expect(result.holdings.map((h) => [h.ticker, h.weightPct])).toEqual([["ES3", 75], ["A35", 25]]);
    expect(JSON.stringify(result)).not.toContain("3000");
  });

  it.each([
    ["the friendship does not exist", { link: null }],
    ["the friendship is still pending", { link: { requesterId: "me", addresseeId: "u-ann", status: "PENDING" as const } }],
    ["the friendship belongs to two other people", { link: { requesterId: "u-x", addresseeId: "u-y", status: "ACCEPTED" as const } }],
    ["the friend keeps holdings private", { friendSharing: { shareHoldings: false } }],
    ["the friend has never set sharing", { friendSharing: null }],
    ["the friend has no plan", { friendPlan: null }],
    ["the friend has an account but holds nothing", { friendPlan: [] }],
  ])("gives the same 404 when %s, so it cannot be used to probe", async (_label, over) => {
    arrange(over);
    await expect(friendsService.getHoldingsDetail("me", "fs-1")).rejects.toMatchObject(NOT_AVAILABLE);
  });

  it("does not read a private friend's plan at all", async () => {
    arrange({ friendSharing: { shareHoldings: false } });
    await expect(friendsService.getHoldingsDetail("me", "fs-1")).rejects.toBeDefined();
    expect(db.plan.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u-ann" } }));
  });

  it('opens the viewer\'s own holdings as "me", with no sharing needed', async () => {
    arrange({});
    const result = await friendsService.getHoldingsDetail("me", "me");
    expect(result).toMatchObject({ displayName: "Me", portfolioName: null });
    expect(db.friendship.findUnique).not.toHaveBeenCalled();
  });

  it('404s for "me" when the viewer has no plan', async () => {
    arrange({ myPlan: null });
    await expect(friendsService.getHoldingsDetail("me", "me")).rejects.toMatchObject(NOT_AVAILABLE);
  });

  it("leaks no ids, emails or amounts", async () => {
    arrange({});
    const json = JSON.stringify(await friendsService.getHoldingsDetail("me", "fs-1"));
    for (const secret of ["u-ann", "@", "contribution", "amount"]) expect(json).not.toContain(secret);
  });
});
