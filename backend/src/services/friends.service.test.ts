/**
 * FriendsService unit tests — DECISIONS.md #8. Two layers:
 *  - pure functions (computeMemberMetrics, buildComparison,
 *    generateInviteCode), tested directly;
 *  - the service's rules, with Prisma and PlanService mocked so these run
 *    without a live Postgres connection. The privacy properties (sharing
 *    filter, no id/email in responses, non-enumerating add-friend response)
 *    are the point of this feature, so they get explicit tests.
 */
import { prisma } from "../config/prisma";
import { planService } from "./plan.service";
import {
  buildComparison,
  computeMemberMetrics,
  friendsService,
  generateInviteCode,
  GENERIC_REQUEST_RESPONSE,
  MAX_FRIENDS,
  MemberMetrics,
  SharingSettings,
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
  },
}));
jest.mock("./plan.service", () => ({
  planService: { getActivePlan: jest.fn() },
  round2: (v: number) => Math.round(v * 100) / 100,
}));

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
};
const plans = planService as unknown as { getActivePlan: jest.Mock };

const ALL_ON: SharingSettings = {
  shareValue: true,
  shareReturn: true,
  shareContributionRate: true,
  shareSavingsRate: true,
  shareEmergencyBuffer: true,
};
const ALL_OFF: SharingSettings = {
  shareValue: false,
  shareReturn: false,
  shareContributionRate: false,
  shareSavingsRate: false,
  shareEmergencyBuffer: false,
};

function metrics(overrides: Partial<MemberMetrics> = {}): MemberMetrics {
  return { value: 100, returnPct: 5, contributionRatePct: 10, savingsRatePct: 30, emergencyBuffer: 2, ...overrides };
}

// ── Pure functions ─────────────────────────────────────────────────────

describe("computeMemberMetrics", () => {
  it("derives all five metrics from a plan and profile", () => {
    const result = computeMemberMetrics(
      { contributionAmount: 100, finalValue: 810.64, totalContributed: 700, growth: 110.64, walletBalance: 9800 },
      { monthlyIncome: 4000, monthlyExpense: 2500 }
    );

    expect(result).toEqual({
      value: 810.64,
      returnPct: 15.81, // 110.64 / 700 = 15.8057%
      contributionRatePct: 2.5, // 100 / 4000
      savingsRatePct: 37.5, // (4000 - 2500) / 4000
      emergencyBuffer: 3.92, // 9800 / 2500
    });
  });

  it("leaves plan-based metrics null when there is no plan, but still derives the savings rate", () => {
    const result = computeMemberMetrics(null, { monthlyIncome: 4000, monthlyExpense: 3000 });

    expect(result).toEqual({
      value: null,
      returnPct: null,
      contributionRatePct: null,
      savingsRatePct: 25,
      emergencyBuffer: null,
    });
  });

  it("returns all nulls with neither plan nor profile, and never divides by zero", () => {
    expect(computeMemberMetrics(null, null)).toEqual({
      value: null,
      returnPct: null,
      contributionRatePct: null,
      savingsRatePct: null,
      emergencyBuffer: null,
    });

    const zeroes = computeMemberMetrics(
      { contributionAmount: 0, finalValue: 0, totalContributed: 0, growth: 0, walletBalance: 0 },
      { monthlyIncome: 0, monthlyExpense: 0 }
    );
    expect(zeroes.returnPct).toBeNull();
    expect(zeroes.contributionRatePct).toBeNull();
    expect(zeroes.savingsRatePct).toBeNull();
    expect(zeroes.emergencyBuffer).toBeNull();
  });
});

describe("buildComparison", () => {
  it("ranks the user and sharing friends high-to-low", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ value: 200 }) }, [
      { displayName: "Ann", metrics: metrics({ value: 300 }), shared: ALL_ON },
      { displayName: "Bob", metrics: metrics({ value: 100 }), shared: ALL_ON },
    ]);

    expect(result.metrics.value.rows).toEqual([
      { displayName: "Ann", isMe: false, value: 300, rank: 1 },
      { displayName: "Me", isMe: true, value: 200, rank: 2 },
      { displayName: "Bob", isMe: false, value: 100, rank: 3 },
    ]);
    expect(result.friendCount).toBe(2);
  });

  it("uses competition ranking for ties (shared rank, next rank skipped)", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ value: 200 }) }, [
      { displayName: "Ann", metrics: metrics({ value: 300 }), shared: ALL_ON },
      { displayName: "Bob", metrics: metrics({ value: 200 }), shared: ALL_ON },
      { displayName: "Cy", metrics: metrics({ value: 100 }), shared: ALL_ON },
    ]);

    expect(result.metrics.value.rows.map((r) => [r.displayName, r.rank])).toEqual([
      ["Ann", 1],
      ["Me", 2],
      ["Bob", 2],
      ["Cy", 4],
    ]);
  });

  it("omits a friend's metric when they haven't shared it, and counts them as hidden without naming them", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ value: 200, savingsRatePct: 30 }) }, [
      { displayName: "Ann", metrics: metrics({ value: 999, savingsRatePct: 99 }), shared: { ...ALL_OFF, shareSavingsRate: true } },
      { displayName: "Bob", metrics: metrics({ value: 888, savingsRatePct: 88 }), shared: ALL_OFF },
    ]);

    // value: nobody but me shares it
    expect(result.metrics.value.rows.map((r) => r.displayName)).toEqual(["Me"]);
    expect(result.metrics.value.hiddenCount).toBe(2);
    expect(JSON.stringify(result.metrics.value)).not.toContain("999");
    expect(JSON.stringify(result.metrics.value)).not.toContain("888");

    // savings rate: Ann shares, Bob doesn't
    expect(result.metrics.savingsRatePct.rows.map((r) => r.displayName)).toEqual(["Ann", "Me"]);
    expect(result.metrics.savingsRatePct.hiddenCount).toBe(1);
  });

  it("always shows the user their own figure regardless of any sharing setting", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ value: 50 }) }, []);

    expect(result.metrics.value.rows).toEqual([{ displayName: "Me", isMe: true, value: 50, rank: 1 }]);
    expect(result.friendCount).toBe(0);
  });

  it("separates 'shares it but has no figure yet' from 'hides it'", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics() }, [
      { displayName: "Ann", metrics: metrics({ value: null }), shared: ALL_ON },
    ]);

    expect(result.metrics.value.noDataCount).toBe(1);
    expect(result.metrics.value.hiddenCount).toBe(0);
    expect(result.metrics.value.rows.map((r) => r.displayName)).toEqual(["Me"]);
  });

  it("leaves the user off a board where they have no figure", () => {
    const result = buildComparison({ displayName: "Me", metrics: metrics({ value: null }) }, [
      { displayName: "Ann", metrics: metrics({ value: 10 }), shared: ALL_ON },
    ]);

    expect(result.metrics.value.rows.map((r) => r.displayName)).toEqual(["Ann"]);
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
    db.friendSharing.upsert.mockResolvedValue({ ...ALL_OFF, shareValue: true });
    db.user.findUnique.mockResolvedValue({ displayName: "Hao" });

    const result = await friendsService.updateSettings("me", { displayName: "  Hao  ", shareValue: true });

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "me" }, data: { displayName: "Hao" } });
    expect(db.friendSharing.upsert).toHaveBeenCalledWith({
      where: { userId: "me" },
      create: { userId: "me", shareValue: true },
      update: { shareValue: true },
    });
    expect(result.sharing.shareValue).toBe(true);
    expect(result.sharing.shareSavingsRate).toBe(false);
  });

  it("rejects an empty or over-long display name", async () => {
    await expect(friendsService.updateSettings("me", { displayName: "   " })).rejects.toThrow();
    await expect(friendsService.updateSettings("me", { displayName: "x".repeat(31) })).rejects.toThrow();
  });
});

describe("FriendsService.getComparison", () => {
  function plan(finalValue: number) {
    return { contributionAmount: 100, finalValue, totalContributed: 500, growth: finalValue - 500, walletBalance: 1000 };
  }

  it("ranks accepted friends, applies each friend's sharing choices, and leaks no ids or emails", async () => {
    db.friendship.findMany.mockResolvedValue([
      { requesterId: "me", addresseeId: "u-ann" },
      { requesterId: "u-bob", addresseeId: "me" },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: "me", displayName: "Me", sharing: null },
      { id: "u-ann", displayName: "Ann", sharing: { ...ALL_ON } },
      { id: "u-bob", displayName: "Bob", sharing: { ...ALL_OFF, shareValue: true } },
    ]);
    db.userProfile.findMany.mockResolvedValue([
      { userId: "me", monthlyIncome: "4000", monthlyExpense: "2500" },
      { userId: "u-ann", monthlyIncome: "5000", monthlyExpense: "2000" },
      { userId: "u-bob", monthlyIncome: "3000", monthlyExpense: "2400" },
    ]);
    plans.getActivePlan.mockImplementation((id: string) =>
      Promise.resolve(id === "me" ? plan(700) : id === "u-ann" ? plan(900) : plan(600))
    );

    const result = await friendsService.getComparison("me");

    // value: all three share/see it
    expect(result.metrics.value.rows.map((r) => [r.displayName, r.rank])).toEqual([
      ["Ann", 1],
      ["Me", 2],
      ["Bob", 3],
    ]);
    // savings rate: Bob shares only value, so he's absent here
    expect(result.metrics.savingsRatePct.rows.map((r) => r.displayName)).toEqual(["Ann", "Me"]);
    expect(result.metrics.savingsRatePct.hiddenCount).toBe(1);

    const json = JSON.stringify(result);
    for (const secret of ["u-ann", "u-bob", "@"]) expect(json).not.toContain(secret);
  });

  it("treats a friend whose plan can't be computed as having no figures instead of failing", async () => {
    db.friendship.findMany.mockResolvedValue([{ requesterId: "me", addresseeId: "u-ann" }]);
    db.user.findMany.mockResolvedValue([
      { id: "me", displayName: "Me", sharing: null },
      { id: "u-ann", displayName: "Ann", sharing: { ...ALL_ON } },
    ]);
    db.userProfile.findMany.mockResolvedValue([{ userId: "me", monthlyIncome: "4000", monthlyExpense: "2500" }]);
    plans.getActivePlan.mockImplementation((id: string) => (id === "me" ? Promise.resolve(plan(700)) : Promise.reject(new Error("boom"))));

    const result = await friendsService.getComparison("me");

    expect(result.metrics.value.rows.map((r) => r.displayName)).toEqual(["Me"]);
    expect(result.metrics.value.noDataCount).toBe(1);
  });

  it("handles a user with no friends", async () => {
    db.friendship.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([{ id: "me", displayName: "Me", sharing: null }]);
    db.userProfile.findMany.mockResolvedValue([]);
    plans.getActivePlan.mockResolvedValue(null);

    const result = await friendsService.getComparison("me");

    expect(result.friendCount).toBe(0);
    expect(result.metrics.value.rows).toEqual([]);
  });
});
