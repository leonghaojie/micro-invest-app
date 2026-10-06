/**
 * FriendsService — DECISIONS.md #8 (friends comparison, 3 Oct 2026).
 *
 * A consent-based way to compare with people the user chose, alongside the
 * anonymous income-range peer group (peerGrouping/peerBenchmark services,
 * which are untouched). Friends comparison shows *named individuals'*
 * numbers, so it is a deliberate exception to NFR-03 ("only aggregated
 * stats") and is guarded accordingly:
 *  - friendships are mutual (request + accept);
 *  - people are found only by invite code or exact email — there is no
 *    search or directory, and sending a request always returns the same
 *    generic response so it can't be used to discover which emails/codes
 *    belong to real accounts (for the same reason outgoing requests are
 *    never listed back to the sender);
 *  - each user opts in, per metric, to what friends can see (all off by
 *    default), and to who: every friend, or only the friends on their private
 *    close-friends list (DECISIONS.md #27); a metric a friend hasn't shared
 *    with the viewer never appears in a response.
 *    The metrics are exactly the ones the cohort comparison measures (investment
 *    rate, contribution consistency, diversification, return, return per unit of
 *    risk; DECISIONS.md #22). The portfolio's value, savings rate and emergency
 *    buffer are not offered at all, so there is nothing to toggle or leak;
 *  - holdings (which funds a friend's plan contains, and their weights) are
 *    a separate opt-in, shareHoldings, off by default (DECISIONS.md #12):
 *    percentages only, never amounts, and a custom portfolio's name (free
 *    text the owner typed) is never shown. They are opened from the friend's
 *    one-to-one comparison (getFriendComparison, DECISIONS.md #26), which
 *    never says whether something is private or simply missing;
 *  - no response ever contains another user's id or email — only a
 *    friendship id (to act on the link) and the chosen display name.
 */
import { randomInt } from "crypto";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { COMPARISON_METRICS, comparisonWindow, memberFigures, ComparisonKey } from "../utils/peerCohort";
import { loadMembers } from "./memberLoader";
import { planService } from "./plan.service";

// ── Metrics ────────────────────────────────────────────────────────────

export const METRIC_KEYS = COMPARISON_METRICS;
export type MetricKey = ComparisonKey;
export type MemberMetrics = Record<MetricKey, number | null>;

/** What the viewer is allowed to see of one friend: on or off for each measure and for holdings. */
export interface SharingSettings {
  shareInvestmentRate: boolean;
  shareConsistency: boolean;
  shareDiversification: boolean;
  shareReturn: boolean;
  shareMonthlyReturn: boolean;
  shareHoldings: boolean;
}

/** Who a choice is shown to (DECISIONS.md #27): nobody, the owner's close friends, or every friend. */
export type Audience = "NONE" | "CLOSE" | "ALL";

/** What a user has chosen to share, and with whom, for each measure and for holdings. */
export type AudienceSettings = Record<keyof SharingSettings, Audience>;

const SHARE_KEYS: (keyof SharingSettings)[] = [
  "shareInvestmentRate",
  "shareConsistency",
  "shareDiversification",
  "shareReturn",
  "shareMonthlyReturn",
  "shareHoldings",
];

/** Maps a stored FriendSharing row (or its absence) to audiences. Anything
 * missing is NONE - privacy by default. */
function toAudienceSettings(row: Partial<Record<keyof SharingSettings, string>> | null | undefined): AudienceSettings {
  const out = {} as AudienceSettings;
  for (const key of SHARE_KEYS) {
    const v = row?.[key];
    out[key] = v === "ALL" || v === "CLOSE" ? v : "NONE";
  }
  return out;
}

/** Pure. What one viewer may see, given the owner's audiences and whether the owner has put the
 * viewer on their close-friends list. CLOSE is shown only to a close friend; ALL to every friend. */
export function effectiveSharing(settings: AudienceSettings, viewerIsClose: boolean): SharingSettings {
  const out = {} as SharingSettings;
  for (const key of SHARE_KEYS) out[key] = settings[key] === "ALL" || (settings[key] === "CLOSE" && viewerIsClose);
  return out;
}

const SHARE_FLAG: Record<MetricKey, keyof SharingSettings> = {
  investmentRate: "shareInvestmentRate",
  consistency: "shareConsistency",
  diversification: "shareDiversification",
  return: "shareReturn",
  monthlyReturn: "shareMonthlyReturn",
};


export const MAX_FRIENDS = 50;

const HOLDINGS_SELECT = { select: { value: true, fund: { select: { ticker: true, name: true, assetClass: true } } } } as const;

/** Pure. An account's holdings as shares of its value (percent), for the holdings views. */
export function snapshotOf(holdings: { value: unknown; fund: { ticker: string; name: string; assetClass: string } }[]): PortfolioSnapshot {
  const total = holdings.reduce((s, h) => s + Number(h.value), 0);
  return {
    name: null,
    isPreset: false,
    allocations: holdings.map((h) => ({ weightPct: total > 0 ? Math.round((Number(h.value) / total) * 10000) / 100 : 0, fund: h.fund })),
  };
}

// ── Ranking ────────────────────────────────────────────────────────────

export interface BoardRow {
  /** Handle for opening this friend's one-to-one comparison; null for the viewer. Never a user id. */
  friendshipId: string | null;
  displayName: string;
  isMe: boolean;
  value: number;
  rank: number;
}

export interface MetricBoard {
  rows: BoardRow[];
  /** Friends who haven't chosen to share this metric (not named). */
  hiddenCount: number;
  /** Friends who share it but have no figure yet (e.g. no plan). */
  noDataCount: number;
}

export type FriendsComparison = {
  friendCount: number;
  /** Every accepted friend by display name, so each can be opened even if they share no measure. */
  friends: FriendLink[];
  /** How many months the return measures cover: the longest recent run the viewer has (up to 12). */
  windowMonths: number;
  metrics: Record<MetricKey, MetricBoard>;
};

interface ComparisonMember {
  displayName: string;
  metrics: MemberMetrics;
}

interface ComparisonFriend extends ComparisonMember {
  friendshipId: string;
  /** Whether the viewer has put this friend on their own close-friends list. */
  close?: boolean;
  shared: SharingSettings;
}

/** Pure. For each metric: the user (always visible to themselves) plus
 * every friend who shares that metric, sorted high-to-low with standard
 * competition ranking (ties share a rank, the next rank is skipped). */
export function buildComparison(me: ComparisonMember, friends: ComparisonFriend[], windowMonths = 0): FriendsComparison {
  const metrics = {} as Record<MetricKey, MetricBoard>;

  for (const key of METRIC_KEYS) {
    const entries: { friendshipId: string | null; displayName: string; isMe: boolean; value: number }[] = [];
    let hiddenCount = 0;
    let noDataCount = 0;

    const mine = me.metrics[key];
    if (mine !== null) entries.push({ friendshipId: null, displayName: me.displayName, isMe: true, value: mine });

    for (const friend of friends) {
      if (!friend.shared[SHARE_FLAG[key]]) {
        hiddenCount += 1;
        continue;
      }
      const theirs = friend.metrics[key];
      if (theirs === null) {
        noDataCount += 1;
        continue;
      }
      entries.push({ friendshipId: friend.friendshipId, displayName: friend.displayName, isMe: false, value: theirs });
    }

    entries.sort((a, b) => b.value - a.value);
    // Competition ranking: an entry's rank is 1 + the number of entries
    // strictly ahead of it, so ties share a rank and the next rank is skipped.
    const rows: BoardRow[] = entries.map((entry) => ({
      ...entry,
      rank: entries.findIndex((e) => e.value === entry.value) + 1,
    }));

    metrics[key] = { rows, hiddenCount, noDataCount };
  }

  const list = friends.map((f) => ({ friendshipId: f.friendshipId, displayName: f.displayName, close: f.close === true })).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { friendCount: friends.length, friends: list, windowMonths, metrics };
}

// ── Invite codes ───────────────────────────────────────────────────────

// 32 unambiguous characters (no I, O, 0, 1) — 8 of them is ~40 bits.
// -- Holdings -----------------------------------------------------------

export interface HoldingRow {
  ticker: string;
  name: string;
  assetClass: string;
  /** Percent of the portfolio, e.g. 40 = 40%. Never a currency amount. */
  weightPct: number;
  /** Whether the viewer also holds this fund. */
  youHold: boolean;
}

export interface MemberHoldings {
  displayName: string;
  /** Only a preset's name ("Balanced"); null for a custom mix, whose name is
   * free text the owner typed and so is never exposed. */
  portfolioName: string | null;
  holdings: HoldingRow[];
}

export interface PortfolioSnapshot {
  /** A preset's name, or null. Accounts no longer have one portfolio (DECISIONS.md #19), so this is null. */
  name: string | null;
  isPreset: boolean;
  /** weightPct is each fund's share of the account's value. */
  allocations: { weightPct: number; fund: { ticker: string; name: string; assetClass: string } }[];
}

/** Pure. Turns what an account holds into a member's holdings, largest first.
 * `viewerTickers` marks the funds the viewer also holds. */
export function toMemberHoldings(displayName: string, portfolio: PortfolioSnapshot, viewerTickers: Set<string>): MemberHoldings {
  return {
    displayName,
    portfolioName: portfolio.isPreset ? portfolio.name : null,
    holdings: portfolio.allocations
      .map((a) => ({
        ticker: a.fund.ticker,
        name: a.fund.name,
        assetClass: a.fund.assetClass,
        weightPct: a.weightPct,
        youHold: viewerTickers.has(a.fund.ticker),
      }))
      .sort((a, b) => b.weightPct - a.weightPct || a.ticker.localeCompare(b.ticker)),
  };
}

/** Pure. A member's weight per asset class, largest first, for a small bar. */
export function mixOf(member: MemberHoldings): { assetClass: string; pct: number }[] {
  const byClass = new Map<string, number>();
  for (const h of member.holdings) byClass.set(h.assetClass, Math.round(((byClass.get(h.assetClass) ?? 0) + h.weightPct) * 100) / 100);
  return [...byClass.entries()].map(([assetClass, pct]) => ({ assetClass, pct })).sort((a, b) => b.pct - a.pct);
}

// -- One-to-one comparison (DECISIONS.md #26) ----------------------------

export interface FriendCompareMetric {
  /** The viewer's own figure, or null when they have none. */
  me: number | null;
  /** The friend's figure, or null: they do not share it, or have no figure. The two are never told apart. */
  friend: number | null;
}

export interface FriendComparisonDetail {
  displayName: string;
  /** Whether the viewer has put this friend on their own close-friends list (only the viewer sees this). */
  close: boolean;
  /** How many months the return measures cover (the viewer's window). */
  windowMonths: number;
  metrics: Record<MetricKey, FriendCompareMetric>;
  /** Both people's holdings as shares of value, or null when the friend's are unavailable (private or none yet). */
  holdings: {
    me: MemberHoldings;
    friend: MemberHoldings;
    myMix: { assetClass: string; pct: number }[];
    friendMix: { assetClass: string; pct: number }[];
  } | null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

// ── Inputs ─────────────────────────────────────────────────────────────

const audience = z.enum(["NONE", "CLOSE", "ALL"]);

const updateSettingsSchema = z.object({
  displayName: z.string().trim().min(1, "Display name can't be empty").max(30, "Display name is at most 30 characters").optional(),
  shareInvestmentRate: audience.optional(),
  shareConsistency: audience.optional(),
  shareDiversification: audience.optional(),
  shareReturn: audience.optional(),
  shareMonthlyReturn: audience.optional(),
  shareHoldings: audience.optional(),
});

const closeSchema = z.object({ close: z.boolean() });

const sendRequestSchema = z
  .object({
    code: z.string().trim().toUpperCase().min(4).max(16).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
  })
  .refine((v) => (v.code !== undefined) !== (v.email !== undefined), {
    message: "Provide either an invite code or an email, not both",
  });

// ── Results ────────────────────────────────────────────────────────────

export interface FriendLink {
  friendshipId: string;
  /** Whether the viewer has put this friend on their own close-friends list (only the viewer sees this). */
  close?: boolean;
  displayName: string;
}

export interface FriendsOverview {
  inviteCode: string;
  displayName: string | null;
  sharing: AudienceSettings;
  friends: FriendLink[];
  incomingRequests: FriendLink[];
}

// Same body whether or not the target exists / is already a friend.
export const GENERIC_REQUEST_RESPONSE = { message: "If that person exists, they'll receive your friend request." };

const FALLBACK_NAME = "Friend";

class FriendsService {
  private async ensureInviteCode(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
    if (!user) throw new HttpError(404, "User not found");
    if (user.inviteCode) return user.inviteCode;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      try {
        await prisma.user.update({ where: { id: userId }, data: { inviteCode: code } });
        return code;
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err; // collision — try another code
      }
    }
    throw new HttpError(500, "Couldn't generate an invite code, please try again");
  }

  private async requireDisplayName(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    if (!user?.displayName) {
      throw new HttpError(400, "Set a display name before adding friends");
    }
    return user.displayName;
  }

  private async acceptedCount(userId: string): Promise<number> {
    return prisma.friendship.count({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    });
  }

  async getOverview(userId: string): Promise<FriendsOverview> {
    const inviteCode = await this.ensureInviteCode(userId);

    const [user, links] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, sharing: true } }),
      prisma.friendship.findMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
        include: {
          requester: { select: { displayName: true } },
          addressee: { select: { displayName: true } },
          closeFriends: { select: { ownerId: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const friends: FriendLink[] = [];
    const incomingRequests: FriendLink[] = [];
    for (const link of links) {
      const iAmRequester = link.requesterId === userId;
      const other = iAmRequester ? link.addressee : link.requester;
      const entry: FriendLink = { friendshipId: link.id, displayName: other.displayName ?? FALLBACK_NAME };
      if (link.status === "ACCEPTED") {
        friends.push({ ...entry, close: link.closeFriends.some((c) => c.ownerId === userId) });
      } else if (!iAmRequester) {
        incomingRequests.push(entry);
      }
      // Outgoing pending requests are deliberately never returned — see
      // the file header (it would defeat the generic add-friend response).
    }

    return {
      inviteCode,
      displayName: user?.displayName ?? null,
      sharing: toAudienceSettings(user?.sharing),
      friends,
      incomingRequests,
    };
  }

  async updateSettings(userId: string, input: unknown): Promise<{ displayName: string | null; sharing: AudienceSettings }> {
    const { displayName, ...toggles } = updateSettingsSchema.parse(input);

    if (displayName !== undefined) {
      await prisma.user.update({ where: { id: userId }, data: { displayName } });
    }

    const sharing = await prisma.friendSharing.upsert({
      where: { userId },
      create: { userId, ...toggles },
      update: { ...toggles },
    });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    return {
      displayName: user?.displayName ?? null,
      sharing: toAudienceSettings(sharing),
    };
  }

  async sendRequest(userId: string, input: unknown): Promise<typeof GENERIC_REQUEST_RESPONSE> {
    const parsed = sendRequestSchema.parse(input);
    await this.requireDisplayName(userId);

    const target = parsed.code
      ? await prisma.user.findUnique({ where: { inviteCode: parsed.code } })
      : await prisma.user.findUnique({ where: { email: parsed.email! } });

    // Unknown target: indistinguishable from success.
    if (!target) return GENERIC_REQUEST_RESPONSE;
    if (target.id === userId) throw new HttpError(400, "You can't add yourself");

    if ((await this.acceptedCount(userId)) >= MAX_FRIENDS) {
      throw new HttpError(400, `You've reached the limit of ${MAX_FRIENDS} friends`);
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: target.id },
          { requesterId: target.id, addresseeId: userId },
        ],
      },
    });

    if (existing) {
      // They already asked us and we're now asking them: both sides have
      // consented, so complete the link instead of leaving two requests.
      if (existing.status === "PENDING" && existing.requesterId === target.id) {
        await prisma.friendship.update({ where: { id: existing.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
      }
      return GENERIC_REQUEST_RESPONSE; // duplicate / already friends: no signal
    }

    await prisma.friendship.create({
      data: {
        requesterId: userId,
        addresseeId: target.id,
        // Demo behaviour: seeded (synthetic) users can't log in to accept,
        // so a request to one is accepted automatically. DECISIONS.md #8.
        status: target.isSynthetic ? "ACCEPTED" : "PENDING",
        respondedAt: target.isSynthetic ? new Date() : null,
      },
    });
    return GENERIC_REQUEST_RESPONSE;
  }

  async acceptRequest(userId: string, friendshipId: string): Promise<void> {
    await this.requireDisplayName(userId);

    const link = await prisma.friendship.findUnique({ where: { id: friendshipId } });
    // Only the addressee of a still-pending request may accept it.
    if (!link || link.addresseeId !== userId || link.status !== "PENDING") {
      throw new HttpError(404, "Request not found");
    }
    if ((await this.acceptedCount(userId)) >= MAX_FRIENDS) {
      throw new HttpError(400, `You've reached the limit of ${MAX_FRIENDS} friends`);
    }

    await prisma.friendship.update({ where: { id: friendshipId }, data: { status: "ACCEPTED", respondedAt: new Date() } });
  }

  /** Decline a request, or remove an accepted friend — either participant. */
  async removeFriendship(userId: string, friendshipId: string): Promise<void> {
    const link = await prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!link || (link.requesterId !== userId && link.addresseeId !== userId)) {
      throw new HttpError(404, "Friend not found");
    }
    await prisma.friendship.delete({ where: { id: friendshipId } });
  }

  async getComparison(userId: string): Promise<FriendsComparison> {
    const links = await prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { id: true, requesterId: true, addresseeId: true },
    });
    const friendIds = links.map((l) => (l.requesterId === userId ? l.addresseeId : l.requesterId));
    const linkIdByFriend = new Map(links.map((l) => [l.requesterId === userId ? l.addresseeId : l.requesterId, l.id]));
    const allIds = [userId, ...friendIds];

    // Each side's private close-friends list: who I put on mine, and who has put me on theirs.
    const closeRows = links.length ? await prisma.closeFriend.findMany({ where: { friendshipId: { in: links.map((l) => l.id) } }, select: { friendshipId: true, ownerId: true } }) : [];
    const myClose = new Set(closeRows.filter((c) => c.ownerId === userId).map((c) => c.friendshipId));
    const closeOwners = new Set(closeRows.filter((c) => c.ownerId !== userId).map((c) => c.ownerId)); // friends who listed me

    const users = await prisma.user.findMany({ where: { id: { in: allIds } }, select: { id: true, displayName: true, sharing: true } });
    const userById = new Map(users.map((u) => [u.id, u]));

    // The user's own account is brought up to date first; friends' accounts are read as stored
    // (reading someone else's never changes it), and kept current by the monthly refresh.
    await planService.getActivePlan(userId).catch(() => null);
    const loaded = await loadMembers(allIds);
    const memberById = new Map((loaded?.members ?? []).map((m) => [m.id, m]));
    // Everyone is measured over the viewer's window, as in the cohort comparison.
    const window = loaded ? comparisonWindow(memberById.get(userId), loaded.asOf) : { months: [], n: 0 };

    const metricsFor = (id: string): MemberMetrics => memberFigures(memberById.get(id), window);

    const me = userById.get(userId);
    const friends: ComparisonFriend[] = friendIds.map((id) => {
      const u = userById.get(id);
      return {
        friendshipId: linkIdByFriend.get(id)!,
        close: myClose.has(linkIdByFriend.get(id)!),
        displayName: u?.displayName ?? FALLBACK_NAME,
        metrics: metricsFor(id),
        // what this friend lets me see: their audiences, applied to whether they have put me on their list
        shared: effectiveSharing(toAudienceSettings(u?.sharing), closeOwners.has(id)),
      };
    });

    return buildComparison({ displayName: me?.displayName ?? "You", metrics: metricsFor(userId) }, friends, window.n);
  }

  /** What an account holds now, as value shares: the account's holdings, or null with nothing held. */
  private async accountHoldings(userId: string) {
    const plan = await prisma.plan.findUnique({ where: { userId }, select: { userId: true, holdings: HOLDINGS_SELECT } });
    return plan && plan.holdings.length > 0 ? plan : null;
  }

  /**
   * One friend, side by side with the viewer (DECISIONS.md #26): every measure with both figures,
   * and both people's holdings. `id` is a friendship id. A friend's figure appears only if they
   * share that measure, and their holdings only if they share holdings and have some; whether a
   * figure is private or just missing is never told apart. Every way the link can be unusable (not
   * yours, not accepted, gone) gives the same 404.
   */
  async getFriendComparison(userId: string, id: string): Promise<FriendComparisonDetail> {
    const NOT_FOUND = new HttpError(404, "Friend not found");
    const link = await prisma.friendship.findUnique({ where: { id }, select: { requesterId: true, addresseeId: true, status: true } });
    if (!link || link.status !== "ACCEPTED" || (link.requesterId !== userId && link.addresseeId !== userId)) throw NOT_FOUND;
    const friendId = link.requesterId === userId ? link.addresseeId : link.requesterId;

    const users = await prisma.user.findMany({ where: { id: { in: [userId, friendId] } }, select: { id: true, displayName: true, sharing: true } });
    const me = users.find((u) => u.id === userId);
    const friend = users.find((u) => u.id === friendId);
    if (!friend) throw NOT_FOUND;
    // What this friend lets me see: their audiences, applied to whether they have put me on their list.
    const listedMe = (await prisma.closeFriend.count({ where: { friendshipId: id, ownerId: friendId } })) > 0;
    const iListed = (await prisma.closeFriend.count({ where: { friendshipId: id, ownerId: userId } })) > 0;
    const shared = effectiveSharing(toAudienceSettings(friend.sharing), listedMe);

    // The viewer's own account is brought up to date; the friend's is read as stored.
    await planService.getActivePlan(userId).catch(() => null);
    const loaded = await loadMembers([userId, friendId]);
    const memberById = new Map((loaded?.members ?? []).map((m) => [m.id, m]));
    const window = loaded ? comparisonWindow(memberById.get(userId), loaded.asOf) : { months: [], n: 0 };
    const mine = memberFigures(memberById.get(userId), window);
    const theirs = memberFigures(memberById.get(friendId), window);

    const metrics = {} as Record<MetricKey, FriendCompareMetric>;
    for (const key of METRIC_KEYS) metrics[key] = { me: mine[key], friend: shared[SHARE_FLAG[key]] ? theirs[key] : null };

    let holdings: FriendComparisonDetail["holdings"] = null;
    if (shared.shareHoldings) {
      const [myPlan, friendPlan] = await Promise.all([this.accountHoldings(userId), this.accountHoldings(friendId)]);
      if (friendPlan) {
        const viewerTickers = new Set(myPlan ? myPlan.holdings.map((h) => h.fund.ticker) : []);
        const friendHoldings = toMemberHoldings(friend.displayName ?? FALLBACK_NAME, snapshotOf(friendPlan.holdings), viewerTickers);
        const myHoldings = toMemberHoldings(me?.displayName ?? "You", snapshotOf(myPlan?.holdings ?? []), new Set(friendPlan.holdings.map((h) => h.fund.ticker)));
        holdings = { me: myHoldings, friend: friendHoldings, myMix: mixOf(myHoldings), friendMix: mixOf(friendHoldings) };
      }
    }

    return { displayName: friend.displayName ?? FALLBACK_NAME, close: iListed, windowMonths: window.n, metrics, holdings };
  }

  /**
   * Puts a friend on, or takes them off, the viewer's private close-friends list (DECISIONS.md #27).
   * `id` is a friendship id. The friend is never told; they only see more (or less) of what the
   * viewer has chosen to share with close friends. Idempotent. Anything that is not an accepted
   * friendship of the viewer's gives the same 404.
   */
  async setCloseFriend(userId: string, id: string, input: unknown): Promise<{ friendshipId: string; close: boolean }> {
    const { close } = closeSchema.parse(input);
    const link = await prisma.friendship.findUnique({ where: { id }, select: { requesterId: true, addresseeId: true, status: true } });
    if (!link || link.status !== "ACCEPTED" || (link.requesterId !== userId && link.addresseeId !== userId)) {
      throw new HttpError(404, "Friend not found");
    }
    if (close) {
      await prisma.closeFriend.upsert({
        where: { friendshipId_ownerId: { friendshipId: id, ownerId: userId } },
        create: { friendshipId: id, ownerId: userId },
        update: {},
      });
    } else {
      await prisma.closeFriend.deleteMany({ where: { friendshipId: id, ownerId: userId } });
    }
    return { friendshipId: id, close };
  }
}

export const friendsService = new FriendsService();
