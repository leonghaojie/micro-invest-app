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
 *    default); a metric a friend hasn't shared never appears in a response;
 *  - no response ever contains another user's id or email — only a
 *    friendship id (to act on the link) and the chosen display name.
 */
import { randomInt } from "crypto";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";
import { planService, round2 } from "./plan.service";

// ── Metrics ────────────────────────────────────────────────────────────

export const METRIC_KEYS = ["value", "returnPct", "contributionRatePct", "savingsRatePct", "emergencyBuffer"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MemberMetrics = Record<MetricKey, number | null>;

export interface SharingSettings {
  shareValue: boolean;
  shareReturn: boolean;
  shareContributionRate: boolean;
  shareSavingsRate: boolean;
  shareEmergencyBuffer: boolean;
}

const SHARE_FLAG: Record<MetricKey, keyof SharingSettings> = {
  value: "shareValue",
  returnPct: "shareReturn",
  contributionRatePct: "shareContributionRate",
  savingsRatePct: "shareSavingsRate",
  emergencyBuffer: "shareEmergencyBuffer",
};

const NO_SHARING: SharingSettings = {
  shareValue: false,
  shareReturn: false,
  shareContributionRate: false,
  shareSavingsRate: false,
  shareEmergencyBuffer: false,
};

export const MAX_FRIENDS = 50;

interface PlanFigures {
  contributionAmount: number;
  finalValue: number;
  totalContributed: number;
  growth: number;
  walletBalance: number;
}

interface ProfileFigures {
  monthlyIncome: number;
  monthlyExpense: number;
}

/** Pure — derives the five comparable metrics from a plan and profile.
 * A metric that can't be computed (no plan yet, zero income...) is null. */
export function computeMemberMetrics(plan: PlanFigures | null, profile: ProfileFigures | null): MemberMetrics {
  const income = profile?.monthlyIncome ?? 0;
  const expense = profile?.monthlyExpense ?? 0;
  return {
    value: plan ? plan.finalValue : null,
    returnPct: plan && plan.totalContributed > 0 ? round2((plan.growth / plan.totalContributed) * 100) : null,
    contributionRatePct: plan && income > 0 ? round2((plan.contributionAmount / income) * 100) : null,
    savingsRatePct: profile && income > 0 ? round2(((income - expense) / income) * 100) : null,
    emergencyBuffer: plan && expense > 0 ? round2(plan.walletBalance / expense) : null,
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

export type FriendsComparison = { friendCount: number; metrics: Record<MetricKey, MetricBoard> };

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
export function buildComparison(me: ComparisonMember, friends: ComparisonFriend[]): FriendsComparison {
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

  return { friendCount: friends.length, metrics };
}

// ── Invite codes ───────────────────────────────────────────────────────

// 32 unambiguous characters (no I, O, 0, 1) — 8 of them is ~40 bits.
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
  shareValue: z.boolean().optional(),
  shareReturn: z.boolean().optional(),
  shareContributionRate: z.boolean().optional(),
  shareSavingsRate: z.boolean().optional(),
  shareEmergencyBuffer: z.boolean().optional(),
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
      sharing: user?.sharing
        ? {
            shareValue: user.sharing.shareValue,
            shareReturn: user.sharing.shareReturn,
            shareContributionRate: user.sharing.shareContributionRate,
            shareSavingsRate: user.sharing.shareSavingsRate,
            shareEmergencyBuffer: user.sharing.shareEmergencyBuffer,
          }
        : { ...NO_SHARING },
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
      sharing: {
        shareValue: sharing.shareValue,
        shareReturn: sharing.shareReturn,
        shareContributionRate: sharing.shareContributionRate,
        shareSavingsRate: sharing.shareSavingsRate,
        shareEmergencyBuffer: sharing.shareEmergencyBuffer,
      },
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

    const [users, profiles] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: allIds } }, select: { id: true, displayName: true, sharing: true } }),
      prisma.userProfile.findMany({ where: { userId: { in: allIds } } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const profileById = new Map(profiles.map((p) => [p.userId, p]));

    // Recompute-on-read per member so a stale PlanMonth never gets ranked.
    // Friend count is capped (MAX_FRIENDS), so this stays cheap.
    const plans = await Promise.all(allIds.map((id) => planService.getActivePlan(id).catch(() => null)));
    const planById = new Map(allIds.map((id, i) => [id, plans[i]]));

    const metricsFor = (id: string): MemberMetrics => {
      const plan = planById.get(id) ?? null;
      const profile = profileById.get(id) ?? null;
      return computeMemberMetrics(
        plan
          ? {
              contributionAmount: plan.contributionAmount,
              finalValue: plan.finalValue,
              totalContributed: plan.totalContributed,
              growth: plan.growth,
              walletBalance: plan.walletBalance,
            }
          : null,
        profile ? { monthlyIncome: Number(profile.monthlyIncome), monthlyExpense: Number(profile.monthlyExpense) } : null
      );
    };

    const me = userById.get(userId);
    const friends: ComparisonFriend[] = friendIds.map((id) => {
      const u = userById.get(id);
      const s = u?.sharing;
      return {
        displayName: u?.displayName ?? FALLBACK_NAME,
        metrics: metricsFor(id),
        shared: s
          ? {
              shareValue: s.shareValue,
              shareReturn: s.shareReturn,
              shareContributionRate: s.shareContributionRate,
              shareSavingsRate: s.shareSavingsRate,
              shareEmergencyBuffer: s.shareEmergencyBuffer,
            }
          : { ...NO_SHARING },
      };
    });

    return buildComparison({ displayName: me?.displayName ?? "You", metrics: metricsFor(userId) }, friends);
  }
}

export const friendsService = new FriendsService();
