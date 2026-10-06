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
  AudienceSettings,
  buildComparison,
  effectiveSharing,
  friendsService,
  generateInviteCode,
  GENERIC_REQUEST_RESPONSE,
  MAX_FRIENDS,
  MemberMetrics,
  METRIC_KEYS,
  PortfolioSnapshot,
  SharingSettings,
  mixOf,
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
    closeFriend: { findMany: jest.fn(), count: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
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
  closeFriend: { findMany: jest.Mock; count: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
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

/** Stored audiences from on/off flags: on is ALL (every friend), off is NONE. */
function aud(flags: Partial<SharingSettings>): AudienceSettings {
  const out = {} as AudienceSettings;
  for (const key of Object.keys(ALL_OFF) as (keyof SharingSettings)[]) out[key] = flags[key] ? "ALL" : "NONE";
  return out;
}

const NONE_ALL: AudienceSettings = aud({});

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
      { friendshipId: "fs-ann", displayName: "Ann", metrics: metrics({ investmentRate: 30 }), shared: ALL_ON },
      { friendshipId: "fs-bob", displayName: "Bob", metrics: metrics({ investmentRate: 10 }), shared: ALL_ON },
    ]);

    expect(result.metrics.investmentRate.rows).toEqual([
      { friendshipId: "fs-ann", displayName: "Ann", isMe: false, value: 30, rank: 1 },
      { friendshipId: null, displayName: "Me", isMe: true, value: 20, rank: 2 },
      { friendshipId: "fs-bob", displayName: "Bob", isMe: false, value: 10, rank: 3 },
    ]);
    expect(result.friendCount).toBe(2);
  });

  it("uses competition ranking for ties (shared rank, next rank skipped)", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ consistency: 80 }) }, [
      { friendshipId: "fs-ann", displayName: "Ann", metrics: metrics({ consistency: 100 }), shared: ALL_ON },
      { friendshipId: "fs-bob", displayName: "Bob", metrics: metrics({ consistency: 80 }), shared: ALL_ON },
      { friendshipId: "fs-cy", displayName: "Cy", metrics: metrics({ consistency: 50 }), shared: ALL_ON },
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
      { friendshipId: "fs-ann", displayName: "Ann", metrics: metrics({ investmentRate: 999, diversification: 99 }), shared: { ...ALL_OFF, shareDiversification: true } },
      { friendshipId: "fs-bob", displayName: "Bob", metrics: metrics({ investmentRate: 888, diversification: 88 }), shared: ALL_OFF },
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
      const result = buildComparison({ displayName: "Me", metrics: metrics() }, [{ friendshipId: "fs-ann", displayName: "Ann", metrics: metrics(), shared: { ...ALL_OFF, [flag]: true } }]);
      for (const other of METRIC_KEYS) {
        expect(result.metrics[other].rows.some((r) => r.displayName === "Ann")).toBe(other === key);
      }
    }
  });

  it("always shows the user their own figure regardless of any sharing setting", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ investmentRate: 5 }) }, []);

    expect(result.metrics.investmentRate.rows).toEqual([{ friendshipId: null, displayName: "Me", isMe: true, value: 5, rank: 1 }]);
    expect(result.friendCount).toBe(0);
  });

  it("separates 'shares it but has no figure yet' from 'hides it'", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics() }, [
      { friendshipId: "fs-ann", displayName: "Ann", metrics: metrics({ investmentRate: null }), shared: ALL_ON },
    ]);

    expect(result.metrics.investmentRate.noDataCount).toBe(1);
    expect(result.metrics.investmentRate.hiddenCount).toBe(0);
    expect(result.metrics.investmentRate.rows.map((r) => r.displayName)).toEqual(["Me"]);
  });

  it("leaves the user off a board where they have no figure", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ return: null }) }, [
      { friendshipId: "fs-ann", displayName: "Ann", metrics: metrics({ return: 10 }), shared: ALL_ON },
    ]);

    expect(result.metrics.return.rows.map((r) => r.displayName)).toEqual(["Ann"]);
  });

  it("carries the number of months the return measures cover", () => {
    expect(buildComparison({ displayName: "Me", metrics: metrics() }, [], 7).windowMonths).toBe(7);
    expect(buildComparison({ displayName: "Me", metrics: metrics() }, []).windowMonths).toBe(0);
  });

  it("gives each friend row a friendship handle to open them with (never a user id), and lists every friend, even ones who share nothing", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics() }, [
      { friendshipId: "fs-zed", displayName: "Zed", metrics: metrics(), shared: ALL_OFF },
      { friendshipId: "fs-ann", displayName: "Ann", metrics: metrics(), shared: { ...ALL_OFF, shareReturn: true } },
    ]);
    expect(result.friends).toEqual([
      { friendshipId: "fs-ann", displayName: "Ann", close: false },
      { friendshipId: "fs-zed", displayName: "Zed", close: false },
    ]);
    expect(result.metrics.return.rows.find((r) => !r.isMe)).toMatchObject({ friendshipId: "fs-ann" });
    expect(result.metrics.return.rows.find((r) => r.isMe)!.friendshipId).toBeNull();
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
    expect(overview.sharing).toEqual(NONE_ALL); // privacy by default: nobody
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
      { id: "f-friend", requesterId: "me", addresseeId: "u-ann", status: "ACCEPTED", requester: { displayName: "Me" }, addressee: { displayName: "Ann" }, closeFriends: [] },
      { id: "f-in", requesterId: "u-bob", addresseeId: "me", status: "PENDING", requester: { displayName: "Bob" }, addressee: { displayName: "Me" }, closeFriends: [] },
      { id: "f-out", requesterId: "me", addresseeId: "u-cy", status: "PENDING", requester: { displayName: "Me" }, addressee: { displayName: "Cy" }, closeFriends: [] },
    ]);

    const overview = await friendsService.getOverview("me");

    expect(overview.friends).toEqual([{ friendshipId: "f-friend", displayName: "Ann", close: false }]);
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
    db.friendSharing.upsert.mockResolvedValue({ ...NONE_ALL, shareInvestmentRate: "ALL" });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });

    const result = await friendsService.updateSettings("me", { displayName: "  Hao  ", shareInvestmentRate: "ALL" });

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "me" }, data: { displayName: "Hao" } });
    expect(db.friendSharing.upsert).toHaveBeenCalledWith({
      where: { userId: "me" },
      create: { userId: "me", shareInvestmentRate: "ALL" },
      update: { shareInvestmentRate: "ALL" },
    });
    expect(result.sharing.shareInvestmentRate).toBe("ALL");
    expect(result.sharing.shareConsistency).toBe("NONE");
  });

  it("saves each measure's audience, independently", async () => {
    db.friendSharing.upsert.mockResolvedValue({ ...NONE_ALL });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });
    await friendsService.updateSettings("me", { shareConsistency: "CLOSE", shareDiversification: "ALL", shareMonthlyReturn: "CLOSE", shareReturn: "NONE" });
    expect(db.friendSharing.upsert).toHaveBeenCalledWith({
      where: { userId: "me" },
      create: { userId: "me", shareConsistency: "CLOSE", shareDiversification: "ALL", shareMonthlyReturn: "CLOSE", shareReturn: "NONE" },
      update: { shareConsistency: "CLOSE", shareDiversification: "ALL", shareMonthlyReturn: "CLOSE", shareReturn: "NONE" },
    });
  });

  it("rejects anything but NONE, CLOSE or ALL (the old true/false no longer applies)", async () => {
    await expect(friendsService.updateSettings("me", { shareReturn: true })).rejects.toThrow();
    await expect(friendsService.updateSettings("me", { shareReturn: "EVERYONE" })).rejects.toThrow();
  });

  it("ignores the removed switches (value, savings rate, emergency buffer): they can no longer be stored", async () => {
    db.friendSharing.upsert.mockResolvedValue({ ...NONE_ALL });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });
    db.friendSharing.upsert.mockClear();
    await friendsService.updateSettings("me", { shareValue: true, shareSavingsRate: true, shareEmergencyBuffer: true, shareContributionRate: true, shareReturnPerRisk: true });
    expect(JSON.stringify(db.friendSharing.upsert.mock.calls)).not.toMatch(/shareValue|shareSavingsRate|shareEmergencyBuffer|shareContributionRate|shareReturnPerRisk/);
  });

  it("saves the holdings audience on its own, and it defaults to nobody", async () => {
    db.friendSharing.upsert.mockResolvedValue({ ...NONE_ALL, shareHoldings: "CLOSE" });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });

    const result = await friendsService.updateSettings("me", { shareHoldings: "CLOSE" });

    expect(db.friendSharing.upsert).toHaveBeenCalledWith({
      where: { userId: "me" },
      create: { userId: "me", shareHoldings: "CLOSE" },
      update: { shareHoldings: "CLOSE" },
    });
    expect(result.sharing.shareHoldings).toBe("CLOSE");
    expect(result.sharing.shareReturn).toBe("NONE"); // the measures' audiences are independent
  });

  it("rejects an unknown holdings audience", async () => {
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
      { id: "fs-ann", requesterId: "me", addresseeId: "u-ann" },
      { id: "fs-bob", requesterId: "u-bob", addresseeId: "me" },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: "me", displayName: "Me", sharing: null },
      { id: "u-ann", displayName: "Ann", sharing: aud(ALL_ON) },
      { id: "u-bob", displayName: "Bob", sharing: aud({ shareInvestmentRate: true }) },
    ]);
    db.closeFriend.findMany.mockResolvedValue([]);
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
    expect(result.metrics.investmentRate.rows).toEqual([{ friendshipId: null, displayName: "Me", isMe: true, value: 10, rank: 1 }]);
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

describe("mixOf", () => {
  it("sums weight per asset class, largest first", () => {
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
      new Set()
    );
    expect(mixOf(member)).toEqual([
      { assetClass: "EQUITY", pct: 70 },
      { assetClass: "BOND", pct: 30 },
    ]);
  });

  it("is empty with nothing held", () => {
    expect(mixOf(toMemberHoldings("Ann", portfolio({ allocations: [] }), new Set()))).toEqual([]);
  });
});

describe("FriendsService.getFriendComparison (one to one, DECISIONS.md #26)", () => {
  const MONTHS = ["2026-07", "2026-08", "2026-09"];
  const NOT_FOUND = { statusCode: 404, message: "Friend not found" };

  function member(id: string, over: Partial<Member> = {}): Member {
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
      monthlyReturns: Object.fromEntries(MONTHS.map((m) => [m, 0.01])),
      ...over,
    };
  }

  const rows = (list: [string, string, number][]) => list.map(([ticker, assetClass, w]) => ({ value: String(w), fund: fund(ticker, assetClass) }));

  interface Setup {
    link?: { requesterId: string; addresseeId: string; status: "ACCEPTED" | "PENDING" } | null;
    sharing?: Partial<SharingSettings> | null;
    members?: Member[];
    myPlan?: ReturnType<typeof rows> | null;
    friendPlan?: ReturnType<typeof rows> | null;
  }

  function arrange(over: Setup = {}) {
    db.friendship.findUnique.mockResolvedValue("link" in over ? over.link : { requesterId: "me", addresseeId: "u-ann", status: "ACCEPTED" });
    db.user.findMany.mockResolvedValue([
      { id: "me", displayName: "Me", sharing: null },
      { id: "u-ann", displayName: "Ann", sharing: "sharing" in over ? over.sharing && aud(over.sharing) : aud(ALL_ON) },
    ]);
    db.closeFriend.count.mockResolvedValue(0);
    plans.getActivePlan.mockResolvedValue({});
    loader.mockResolvedValue({ asOf: "2026-09", simulated: 0, fundReturns: {}, members: over.members ?? [member("me"), member("u-ann", { monthlyReturns: Object.fromEntries(MONTHS.map((m) => [m, 0.02])) })] });
    db.plan.findUnique.mockImplementation(({ where }: { where: { userId: string } }) => {
      const p = where.userId === "me" ? ("myPlan" in over ? over.myPlan : rows([["ES3", "EQUITY", 100]])) : "friendPlan" in over ? over.friendPlan : rows([["ES3", "EQUITY", 60], ["A35", "BOND", 40]]);
      return Promise.resolve(p ? { userId: where.userId, holdings: p } : null);
    });
  }

  it("gives both figures for every measure the friend shares, over the viewer's months", async () => {
    arrange();
    const result = await friendsService.getFriendComparison("me", "fs-ann");

    expect(result.displayName).toBe("Ann");
    expect(result.windowMonths).toBe(3);
    expect(Object.keys(result.metrics)).toEqual([...METRIC_KEYS]);
    expect(result.metrics.return).toEqual({ me: 3.03, friend: 6.12 }); // 3 months at 1% and at 2%, compounded
    expect(result.metrics.monthlyReturn).toEqual({ me: 1, friend: 2 });
    expect(result.metrics.investmentRate).toEqual({ me: 10, friend: 10 });
    expect(result.metrics.consistency).toEqual({ me: 90, friend: 90 });
  });

  it("shows only what the friend shares, and never tells 'private' from 'no figure yet'", async () => {
    arrange({ sharing: { shareReturn: true }, members: [member("me"), member("u-ann", { monthlyReturns: {}, consistencyPct: null })] });
    const result = await friendsService.getFriendComparison("me", "fs-ann");

    expect(result.metrics.investmentRate.friend).toBeNull(); // not shared
    expect(result.metrics.consistency.friend).toBeNull(); // not shared (and no figure)
    expect(result.metrics.return.friend).toBeNull(); // shared, but no figure for those months
    expect(result.metrics.return.me).toBe(3.03); // the viewer's own figure is always there
    // nothing in the response distinguishes the cases: the same null
    expect(JSON.stringify(result.metrics.investmentRate)).toBe(JSON.stringify(result.metrics.return).replace("3.03", "10"));
  });

  it("never includes the portfolio's value, an id or an email", async () => {
    arrange();
    const json = JSON.stringify(await friendsService.getFriendComparison("me", "fs-ann"));
    for (const secret of ["987654", "u-ann", "@", "value", "userId"]) expect(json).not.toContain(secret);
  });

  it("gives both people's holdings as shares of value, with the funds you hold in common marked, when the friend shares them", async () => {
    arrange();
    const { holdings } = await friendsService.getFriendComparison("me", "fs-ann");

    expect(holdings!.friend.holdings.map((h) => [h.ticker, h.weightPct, h.youHold])).toEqual([
      ["ES3", 60, true],
      ["A35", 40, false],
    ]);
    expect(holdings!.me.holdings.map((h) => [h.ticker, h.weightPct, h.youHold])).toEqual([["ES3", 100, true]]);
    expect(holdings!.friendMix).toEqual([
      { assetClass: "EQUITY", pct: 60 },
      { assetClass: "BOND", pct: 40 },
    ]);
    expect(holdings!.myMix).toEqual([{ assetClass: "EQUITY", pct: 100 }]);
    expect(holdings!.friend.portfolioName).toBeNull(); // an account has no single portfolio, and a custom name is never shown
  });

  it("returns no holdings, and does not read the friend's plan, when they keep them private", async () => {
    arrange({ sharing: { shareHoldings: false } });
    const result = await friendsService.getFriendComparison("me", "fs-ann");

    expect(result.holdings).toBeNull();
    expect(db.plan.findUnique).not.toHaveBeenCalled();
  });

  it("returns no holdings when the friend shares them but has none yet", async () => {
    arrange({ friendPlan: null });
    expect((await friendsService.getFriendComparison("me", "fs-ann")).holdings).toBeNull();
  });

  it("still compares when the viewer holds nothing yet: their list is empty and no fund is in common", async () => {
    arrange({ myPlan: null, members: [member("u-ann")] });
    const result = await friendsService.getFriendComparison("me", "fs-ann");

    expect(result.metrics.return.me).toBeNull();
    expect(result.metrics.return.friend).toBeNull(); // measured over the viewer's months, and they have none
    expect(result.metrics.investmentRate.friend).not.toBeNull(); // the measures that need no window still show
    expect(result.holdings!.me.holdings).toEqual([]);
    expect(result.holdings!.friend.holdings.every((h) => !h.youHold)).toBe(true);
  });

  it("works when the viewer is the addressee of the friendship", async () => {
    arrange({ link: { requesterId: "u-ann", addresseeId: "me", status: "ACCEPTED" } });
    expect((await friendsService.getFriendComparison("me", "fs-ann")).displayName).toBe("Ann");
  });

  it("gives the same 404 for a missing, pending or someone else's friendship", async () => {
    for (const link of [null, { requesterId: "me", addresseeId: "u-ann", status: "PENDING" as const }, { requesterId: "u-x", addresseeId: "u-y", status: "ACCEPTED" as const }]) {
      arrange({ link });
      await expect(friendsService.getFriendComparison("me", "fs-ann")).rejects.toMatchObject(NOT_FOUND);
    }
    expect(loader).toHaveBeenCalledTimes(0);
  });

  it("brings only the viewer's own account up to date and loads just the two people", async () => {
    arrange();
    await friendsService.getFriendComparison("me", "fs-ann");
    expect(plans.getActivePlan).toHaveBeenCalledWith("me");
    expect(loader).toHaveBeenCalledWith(["me", "u-ann"]);
  });

  it("copes with no fund data at all", async () => {
    arrange();
    loader.mockResolvedValue(null);
    const result = await friendsService.getFriendComparison("me", "fs-ann");
    expect(result.windowMonths).toBe(0);
    for (const key of METRIC_KEYS) expect(result.metrics[key]).toEqual({ me: null, friend: null });
  });
});

// -- Close friends (DECISIONS.md #27) -------------------------------------

describe("effectiveSharing", () => {
  const settings = (over: Partial<AudienceSettings>): AudienceSettings => ({ ...NONE_ALL, ...over });

  it("shows ALL to every friend, CLOSE only to a close friend, and NONE to nobody", () => {
    const owner = settings({ shareReturn: "ALL", shareConsistency: "CLOSE", shareDiversification: "NONE" });

    expect(effectiveSharing(owner, false)).toMatchObject({ shareReturn: true, shareConsistency: false, shareDiversification: false });
    expect(effectiveSharing(owner, true)).toMatchObject({ shareReturn: true, shareConsistency: true, shareDiversification: false });
  });

  it("is off for everything by default, even for a close friend", () => {
    expect(Object.values(effectiveSharing(NONE_ALL, true)).every((v) => v === false)).toBe(true);
  });

  it("applies to holdings like to any measure", () => {
    expect(effectiveSharing(settings({ shareHoldings: "CLOSE" }), false).shareHoldings).toBe(false);
    expect(effectiveSharing(settings({ shareHoldings: "CLOSE" }), true).shareHoldings).toBe(true);
  });
});

describe("FriendsService.setCloseFriend", () => {
  const accepted = { requesterId: "me", addresseeId: "u-ann", status: "ACCEPTED" as const };

  beforeEach(() => {
    db.closeFriend.upsert.mockReset();
    db.closeFriend.deleteMany.mockReset();
  });

  it("puts a friend on the viewer's own list (and only theirs), idempotently", async () => {
    db.friendship.findUnique.mockResolvedValue(accepted);
    const result = await friendsService.setCloseFriend("me", "fs-ann", { close: true });

    expect(result).toEqual({ friendshipId: "fs-ann", close: true });
    expect(db.closeFriend.upsert).toHaveBeenCalledWith({
      where: { friendshipId_ownerId: { friendshipId: "fs-ann", ownerId: "me" } },
      create: { friendshipId: "fs-ann", ownerId: "me" },
      update: {},
    });
  });

  it("takes a friend off the viewer's list without touching the other side's", async () => {
    db.friendship.findUnique.mockResolvedValue(accepted);
    await friendsService.setCloseFriend("me", "fs-ann", { close: false });
    expect(db.closeFriend.deleteMany).toHaveBeenCalledWith({ where: { friendshipId: "fs-ann", ownerId: "me" } });
  });

  it("works for the addressee too, always as that person's own list", async () => {
    db.friendship.findUnique.mockResolvedValue({ requesterId: "u-ann", addresseeId: "me", status: "ACCEPTED" });
    await friendsService.setCloseFriend("me", "fs-ann", { close: true });
    expect(db.closeFriend.upsert.mock.calls[0][0].create.ownerId).toBe("me");
  });

  it("gives the same 404 for a missing, pending or someone else's friendship, and writes nothing", async () => {
    for (const link of [null, { ...accepted, status: "PENDING" as const }, { requesterId: "u-x", addresseeId: "u-y", status: "ACCEPTED" as const }]) {
      db.friendship.findUnique.mockResolvedValue(link);
      await expect(friendsService.setCloseFriend("me", "fs-ann", { close: true })).rejects.toMatchObject({ statusCode: 404, message: "Friend not found" });
    }
    expect(db.closeFriend.upsert).not.toHaveBeenCalled();
  });

  it("requires a boolean", async () => {
    await expect(friendsService.setCloseFriend("me", "fs-ann", { close: "yes" })).rejects.toThrow();
    await expect(friendsService.setCloseFriend("me", "fs-ann", {})).rejects.toThrow();
  });
});

describe("close friends in the comparisons", () => {
  const ASOF = "2026-09";
  const MONTHS = ["2026-07", "2026-08", "2026-09"];
  const member = (id: string): Member => ({
    id,
    age: 28,
    income: 4000,
    expense: 2400,
    risk: "MEDIUM",
    contribution: 400,
    consistencyPct: 90,
    holdings: [{ assetClass: "EQUITY", weight: 1 }],
    monthlyReturns: Object.fromEntries(MONTHS.map((m) => [m, 0.01])),
  });

  beforeEach(() => {
    plans.getActivePlan.mockResolvedValue({});
    loader.mockResolvedValue({ asOf: ASOF, simulated: 0, fundReturns: {}, members: [member("me"), member("u-ann"), member("u-bob")] });
    db.friendship.findMany.mockResolvedValue([
      { id: "fs-ann", requesterId: "me", addresseeId: "u-ann" },
      { id: "fs-bob", requesterId: "u-bob", addresseeId: "me" },
    ]);
    // Ann shares return with everyone and consistency with close friends only; Bob shares consistency with close friends only
    db.user.findMany.mockResolvedValue([
      { id: "me", displayName: "Me", sharing: null },
      { id: "u-ann", displayName: "Ann", sharing: { ...NONE_ALL, shareReturn: "ALL", shareConsistency: "CLOSE" } },
      { id: "u-bob", displayName: "Bob", sharing: { ...NONE_ALL, shareConsistency: "CLOSE" } },
    ]);
  });

  it("shows a CLOSE measure only to the friends who put the viewer on their list, and an ALL measure to everyone", async () => {
    db.closeFriend.findMany.mockResolvedValue([{ friendshipId: "fs-ann", ownerId: "u-ann" }]); // Ann listed me; Bob did not

    const result = await friendsService.getComparison("me");

    expect(result.metrics.return.rows.map((r) => r.displayName).sort()).toEqual(["Ann", "Me"]);
    expect(result.metrics.consistency.rows.map((r) => r.displayName).sort()).toEqual(["Ann", "Me"]); // Bob keeps it for his close friends
    expect(result.metrics.consistency.hiddenCount).toBe(1); // and is counted, never named
  });

  it("does not depend on the viewer's own list: putting a friend on mine shows me nothing more of theirs", async () => {
    db.closeFriend.findMany.mockResolvedValue([{ friendshipId: "fs-bob", ownerId: "me" }]); // I listed Bob; Bob has not listed me

    const result = await friendsService.getComparison("me");

    expect(result.metrics.consistency.rows.map((r) => r.displayName)).toEqual(["Me"]);
    expect(result.friends.find((f) => f.displayName === "Bob")!.close).toBe(true); // only my own marking is reported
    expect(result.friends.find((f) => f.displayName === "Ann")!.close).toBe(false);
  });

  it("never reveals whether anyone has put the viewer on their list", async () => {
    db.closeFriend.findMany.mockResolvedValue([{ friendshipId: "fs-ann", ownerId: "u-ann" }]);
    const json = JSON.stringify(await friendsService.getComparison("me"));
    expect(json).not.toContain("u-ann");
    expect(json).not.toMatch(/listedMe|closeOwners|ownerId/);
  });

  it("applies the same rule on a friend's page, and reports only the viewer's own marking", async () => {
    db.friendship.findUnique.mockResolvedValue({ requesterId: "me", addresseeId: "u-ann", status: "ACCEPTED" });
    db.user.findMany.mockResolvedValue([
      { id: "me", displayName: "Me", sharing: null },
      { id: "u-ann", displayName: "Ann", sharing: { ...NONE_ALL, shareReturn: "ALL", shareConsistency: "CLOSE", shareHoldings: "CLOSE" } },
    ]);
    db.plan.findUnique.mockResolvedValue({ userId: "u-ann", holdings: [{ value: "100", fund: { ticker: "ES3", name: "ES3 Fund", assetClass: "EQUITY" } }] });

    // Ann has not listed me: I see her ALL measure only, and no holdings; I have not listed her either.
    db.closeFriend.count.mockImplementation(({ where }: { where: { ownerId: string } }) => Promise.resolve(0 * where.ownerId.length));
    let result = await friendsService.getFriendComparison("me", "fs-ann");
    expect(result.metrics.return.friend).not.toBeNull();
    expect(result.metrics.consistency.friend).toBeNull();
    expect(result.holdings).toBeNull();
    expect(result.close).toBe(false);

    // Ann has listed me (I have also listed her): I see consistency and holdings, and my own marking shows.
    db.closeFriend.count.mockResolvedValue(1);
    result = await friendsService.getFriendComparison("me", "fs-ann");
    expect(result.metrics.consistency.friend).not.toBeNull();
    expect(result.holdings).not.toBeNull();
    expect(result.close).toBe(true);
  });

  it("the overview lists my own close friends and nobody else's", async () => {
    db.user.findUnique.mockResolvedValue({ inviteCode: "EXISTING", displayName: "Me", sharing: null });
    db.friendship.findMany.mockResolvedValue([
      { id: "fs-ann", requesterId: "me", addresseeId: "u-ann", status: "ACCEPTED", requester: { displayName: "Me" }, addressee: { displayName: "Ann" }, closeFriends: [{ ownerId: "me" }] },
      { id: "fs-bob", requesterId: "u-bob", addresseeId: "me", status: "ACCEPTED", requester: { displayName: "Bob" }, addressee: { displayName: "Me" }, closeFriends: [{ ownerId: "u-bob" }] },
    ]);

    const overview = await friendsService.getOverview("me");

    expect(overview.friends).toEqual([
      { friendshipId: "fs-ann", displayName: "Ann", close: true },
      { friendshipId: "fs-bob", displayName: "Bob", close: false }, // Bob listed me, which I am never told
    ]);
  });
});
