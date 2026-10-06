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
 *    default); a metric a friend hasn't shared never appears in a response.
 *    The metrics are exactly the ones the cohort comparison measures (investment
 *    rate, contribution consistency, diversification, return, return per unit of
 *    risk; DECISIONS.md #22). The portfolio's value, savings rate and emergency
 *    buffer are not offered at all, so there is nothing to toggle or leak;
 *  - holdings (which funds a friend's plan contains, and their weights) are
 *    a separate opt-in, shareHoldings, off by default (DECISIONS.md #12):
 *    percentages only, never amounts, and a custom portfolio's name (free
 *    text the owner typed) is never shown;
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

export interface SharingSettings {
  shareInvestmentRate: boolean;
  shareConsistency: boolean;
  shareDiversification: boolean;
  shareReturn: boolean;
  shareMonthlyReturn: boolean;
  shareHoldings: boolean;
}

/** Maps a stored FriendSharing row (or its absence) to settings. Anything
 * missing is off - privacy by default. */
function toSharingSettings(row: Partial<SharingSettings> | null | undefined): SharingSettings {
  return {
    shareInvestmentRate: row?.shareInvestmentRate ?? false,
    shareConsistency: row?.shareConsistency ?? false,
    shareDiversification: row?.shareDiversification ?? false,
    shareReturn: row?.shareReturn ?? false,
    shareMonthlyReturn: row?.shareMonthlyReturn ?? false,
    shareHoldings: row?.shareHoldings ?? false,
  };
}

const SHARE_FLAG: Record<MetricKey, keyof SharingSettings> = {
  investmentRate: "shareInvestmentRate",
  consistency: "shareConsistency",
  diversification: "shareDiversification",
  return: "shareReturn",
  monthlyReturn: "shareMonthlyReturn",
};

const NO_SHARING: SharingSettings = {
  shareInvestmentRate: false,
  shareConsistency: false,
  shareDiversification: false,
  shareReturn: false,
  shareMonthlyReturn: false,
  shareHoldings: false,
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
  /** How many months the return measures cover: the longest recent run the viewer has (up to 12). */
  windowMonths: number;
  metrics: Record<MetricKey, MetricBoard>;
};

interface ComparisonMember {
  displayName: string;
  metrics: MemberMetrics;
}

interface ComparisonFriend extends ComparisonMember {
  shared: SharingSettings;
}

/** Pure. For each metric: the user (always visible to themselves) plus
 * every friend who shares that metric, sorted high-to-low with standard
 * competition ranking (ties share a rank, the next rank is skipped). */
export function buildComparison(me: ComparisonMember, friends: ComparisonFriend[], windowMonths = 0): FriendsComparison {
  const metrics = {} as Record<MetricKey, MetricBoard>;

  for (const key of METRIC_KEYS) {
    const entries: { displayName: string; isMe: boolean; value: number }[] = [];
    let hiddenCount = 0;
    let noDataCount = 0;

    const mine = me.metrics[key];
    if (mine !== null) entries.push({ displayName: me.displayName, isMe: true, value: mine });

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
      entries.push({ displayName: friend.displayName, isMe: false, value: theirs });
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

  return { friendCount: friends.length, windowMonths, metrics };
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

/** One row of the friends list: just enough to choose who to open. The
 * full list of funds is fetched per person (getHoldingsDetail) so a long
 * friends list, or a portfolio with dozens of funds, never has to be sent or
 * drawn all at once. */
export interface HoldingsSummary {
  /** Handle for opening this person's detail; null for the viewer themselves
   * (opened as "me"). Never a user id. */
  friendshipId: string | null;
  displayName: string;
  portfolioName: string | null;
  fundCount: number;
  /** Funds in this portfolio that the viewer also holds (0 for the viewer). */
  sharedFundCount: number;
  /** Weight per asset class, largest first, for a small bar. */
  mix: { assetClass: string; pct: number }[];
}

export interface HoldingsOverview {
  friendCount: number;
  /** The viewer's own holdings (always visible to themselves), or null with no plan. */
  me: HoldingsSummary | null;
  /** Friends who share holdings and have a plan, by display name. */
  friends: HoldingsSummary[];
  /** Friends who keep holdings private (not named). */
  hiddenCount: number;
  /** Friends who share holdings but have no plan yet. */
  noPlanCount: number;
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

/** Pure. Condenses a member's holdings into a friends-list row. */
export function summarizeHoldings(member: MemberHoldings, friendshipId: string | null): HoldingsSummary {
  const byClass = new Map<string, number>();
  for (const h of member.holdings) byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.weightPct);
  return {
    friendshipId,
    displayName: member.displayName,
    portfolioName: member.portfolioName,
    fundCount: member.holdings.length,
    sharedFundCount: friendshipId === null ? 0 : member.holdings.filter((h) => h.youHold).length,
    mix: [...byClass.entries()].map(([assetClass, pct]) => ({ assetClass, pct })).sort((a, b) => b.pct - a.pct),
  };
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

const updateSettingsSchema = z.object({
  displayName: z.string().trim().min(1, "Display name can't be empty").max(30, "Display name is at most 30 characters").optional(),
  shareInvestmentRate: z.boolean().optional(),
  shareConsistency: z.boolean().optional(),
  shareDiversification: z.boolean().optional(),
  shareReturn: z.boolean().optional(),
  shareMonthlyReturn: z.boolean().optional(),
  shareHoldings: z.boolean().optional(),
});

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
  displayName: string;
}

export interface FriendsOverview {
  inviteCode: string;
  displayName: string | null;
  sharing: SharingSettings;
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
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const friends: FriendLink[] = [];
    const incomingRequests: FriendLink[] = [];
    for (const link of links) {
      const iAmRequester = link.requesterId === userId;
      const other = iAmRequester ? link.addressee : link.requester;
      const entry = { friendshipId: link.id, displayName: other.displayName ?? FALLBACK_NAME };
      if (link.status === "ACCEPTED") {
        friends.push(entry);
      } else if (!iAmRequester) {
        incomingRequests.push(entry);
      }
      // Outgoing pending requests are deliberately never returned — see
      // the file header (it would defeat the generic add-friend response).
    }

    return {
      inviteCode,
      displayName: user?.displayName ?? null,
      sharing: toSharingSettings(user?.sharing),
      friends,
      incomingRequests,
    };
  }

  async updateSettings(userId: string, input: unknown): Promise<{ displayName: string | null; sharing: SharingSettings }> {
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
      sharing: toSharingSettings(sharing),
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
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = links.map((l) => (l.requesterId === userId ? l.addresseeId : l.requesterId));
    const allIds = [userId, ...friendIds];

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
      const s = u?.sharing;
      return {
        displayName: u?.displayName ?? FALLBACK_NAME,
        metrics: metricsFor(id),
        shared: toSharingSettings(s),
      };
    });

    return buildComparison({ displayName: me?.displayName ?? "You", metrics: metricsFor(userId) }, friends, window.n);
  }

  /** What an account holds now, as value shares: the account's holdings, or null with nothing held. */
  private async accountHoldings(userId: string) {
    const plan = await prisma.plan.findUnique({ where: { userId }, select: { userId: true, holdings: HOLDINGS_SELECT } });
    return plan && plan.holdings.length > 0 ? plan : null;
  }

  /** The friends list for the Holdings view: who shares, and a one-line
   * summary of each. Only display names, a friendship handle, fund counts and
   * an asset-class mix - never an id, an email, an amount, or a custom
   * portfolio's name. */
  async getHoldings(userId: string): Promise<HoldingsOverview> {
    const links = await prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { id: true, requesterId: true, addresseeId: true },
    });
    const linkByFriend = new Map(links.map((l) => [l.requesterId === userId ? l.addresseeId : l.requesterId, l.id]));
    const friendIds = [...linkByFriend.keys()];

    const friendUsers = friendIds.length
      ? await prisma.user.findMany({
          where: { id: { in: friendIds } },
          select: { id: true, displayName: true, sharing: { select: { shareHoldings: true } } },
        })
      : [];
    const sharers = friendUsers.filter((u) => u.sharing?.shareHoldings === true);

    const [myPlan, sharerPlans, meUser] = await Promise.all([
      this.accountHoldings(userId),
      sharers.length ? prisma.plan.findMany({ where: { userId: { in: sharers.map((u) => u.id) } }, select: { userId: true, holdings: HOLDINGS_SELECT } }) : [],
      prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    ]);

    const viewerTickers = new Set(myPlan ? myPlan.holdings.map((h) => h.fund.ticker) : []);
    const planByUser = new Map(sharerPlans.filter((p) => p.holdings.length > 0).map((p) => [p.userId, p]));

    const friends: HoldingsSummary[] = [];
    let noPlanCount = 0;
    for (const u of sharers) {
      const plan = planByUser.get(u.id);
      if (!plan) {
        noPlanCount += 1;
        continue;
      }
      friends.push(
        summarizeHoldings(toMemberHoldings(u.displayName ?? FALLBACK_NAME, snapshotOf(plan.holdings), viewerTickers), linkByFriend.get(u.id)!)
      );
    }
    friends.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return {
      friendCount: friendIds.length,
      me: myPlan ? summarizeHoldings(toMemberHoldings(meUser?.displayName ?? "You", snapshotOf(myPlan.holdings), viewerTickers), null) : null,
      friends,
      hiddenCount: friendUsers.length - sharers.length,
      noPlanCount,
    };
  }

  /** One person's full holdings, opened from the list. `id` is a friendship
   * id, or "me". Every way this can fail - not your friendship, not accepted,
   * friend keeps holdings private, no plan - gives the same 404, so it can't
   * be used to probe who shares what. */
  async getHoldingsDetail(userId: string, id: string): Promise<MemberHoldings> {
    const NOT_AVAILABLE = new HttpError(404, "Holdings not available");

    const myPlan = await this.accountHoldings(userId);
    const viewerTickers = new Set(myPlan ? myPlan.holdings.map((h) => h.fund.ticker) : []);

    if (id === "me") {
      if (!myPlan) throw NOT_AVAILABLE;
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      return toMemberHoldings(me?.displayName ?? "You", snapshotOf(myPlan.holdings), viewerTickers);
    }

    const link = await prisma.friendship.findUnique({ where: { id }, select: { requesterId: true, addresseeId: true, status: true } });
    if (!link || link.status !== "ACCEPTED" || (link.requesterId !== userId && link.addresseeId !== userId)) {
      throw NOT_AVAILABLE;
    }
    const friendId = link.requesterId === userId ? link.addresseeId : link.requesterId;

    const friend = await prisma.user.findUnique({
      where: { id: friendId },
      select: { displayName: true, sharing: { select: { shareHoldings: true } } },
    });
    if (friend?.sharing?.shareHoldings !== true) throw NOT_AVAILABLE;

    const friendPlan = await this.accountHoldings(friendId);
    if (!friendPlan) throw NOT_AVAILABLE;

    return toMemberHoldings(friend.displayName ?? FALLBACK_NAME, snapshotOf(friendPlan.holdings), viewerTickers);
  }
}

export const friendsService = new FriendsService();
