/**
 * S-04 Dashboard — UC-04. A portfolio overview in the style of a brokerage
 * account screen (DECISIONS.md #17, 4 Oct 2026), built from the user's one active
 * Plan (plan.service.ts) and profile (DECISIONS.md #1 third amendment).
 *
 *   1. Summary card — total assets (invested value + cash), last month's profit or
 *      loss, then securities value, unrealised P&L and cash balance.
 *   2. Your holdings — the plan's funds with their weight and value; tap one to
 *      see its history. Long lists are capped with "Show all".
 *   3. Growth over time and Savings Rate, as before.
 *   4. Account — display name, email, password, log out. Each opens its own
 *      screen, so the dashboard stays a list. Also available with no plan.
 *
 * NFR-01: target <2s load. Data reloads on every focus.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch, ApiError, clearStoredAuthToken } from "../api/client";
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS } from "../components/charts/MixBar";
import type { MainTabScreenProps, RootStackParamList } from "../navigation/AppNavigator";

type Props = MainTabScreenProps<"Dashboard">;

interface Holding {
  fundId: string;
  ticker: string;
  name: string;
  assetClass: string;
  currency: string;
  weightPct: number;
  value: number;
}

interface LatestPlan {
  planId: string;
  portfolioName: string;
  portfolioIsPreset: boolean;
  startMonth: string;
  contributionAmount: number;
  monthsRunning: number;
  finalValue: number;
  totalContributed: number;
  growth: number;
  growthPct: number | null;
  walletBalance: number;
  totalAssets: number;
  lastMonth: { month: string; pnl: number; pnlPct: number | null } | null;
  holdings: Holding[];
}

interface DashboardSummary {
  hasPlan: boolean;
  latestPlan: LatestPlan | null;
}

interface GrowthPoint {
  monthDate: string;
  portfolioValue: number;
  walletBalance: number;
}

interface DashboardGrowth {
  planId: string | null;
  portfolioName: string | null;
  points: GrowthPoint[];
}

interface ProfileResponse {
  monthlyExpense: number;
  savingsRatePct: number;
}

interface Me {
  user: { id: string; email: string; displayName: string | null };
}

const MAX_BARS = 16;
const HOLDINGS_SHOWN = 6; // holdings listed before "Show all"
const UP = "#7ee2a8"; // on the blue summary card
const DOWN = "#ff9d9d";
const LOSS = "#c0392b";

export function DashboardScreen({ navigation }: Props) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [growth, setGrowth] = useState<DashboardGrowth | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllHoldings, setShowAllHoldings] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<DashboardSummary>("/dashboard/summary"),
      apiFetch<DashboardGrowth>("/dashboard/growth"),
      apiFetch<ProfileResponse>("/user/profile").catch(() => null),
      apiFetch<Me>("/auth/me").catch(() => null),
    ])
      .then(([summaryRes, growthRes, profileRes, meRes]) => {
        if (cancelled) return;
        setSummary(summaryRes);
        setGrowth(growthRes);
        setProfile(profileRes);
        setMe(meRes?.user ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  async function handleLogout() {
    await clearStoredAuthToken();
    navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.reset({
      index: 0,
      routes: [{ name: "WelcomeLogin" }],
    });
  }

  if (loading && !summary) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>
    );
  }

  const account = (
    <AccountSection
      me={me}
      onEdit={(kind) => navigation.navigate("EditAccount", { kind })}
      onLogout={handleLogout}
    />
  );

  if (!summary?.hasPlan || !summary.latestPlan) {
    return (
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>No plan yet</Text>
        <Text style={styles.subtitle}>Start a plan to see your dashboard.</Text>
        <Pressable style={styles.submitButton} onPress={() => navigation.navigate("Contribution")}>
          <Text style={styles.submitButtonText}>Start your plan</Text>
        </Pressable>
        {account}
      </ScrollView>
    );
  }

  const plan = summary.latestPlan;
  const bars = downsample(growth?.points ?? [], MAX_BARS);
  const maxValue = Math.max(...bars.map((b) => b.portfolioValue), 1);
  const emergencyBuffer = profile && profile.monthlyExpense > 0 ? plan.walletBalance / profile.monthlyExpense : null;
  const holdings = showAllHoldings ? plan.holdings : plan.holdings.slice(0, HOLDINGS_SHOWN);

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.headerSub}>Since {plan.startMonth.slice(0, 7)}</Text>
      </View>

      {/* 1. Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryTop}>
          <View>
            <Text style={styles.summaryLabel}>Total assets</Text>
            <Text style={styles.summaryBig}>{formatCurrency(plan.totalAssets)}</Text>
          </View>
          {plan.lastMonth && (
            <View style={styles.lastMonth}>
              <Text style={styles.summaryLabel}>Last month</Text>
              <Text style={[styles.lastMonthValue, { color: plan.lastMonth.pnl >= 0 ? UP : DOWN }]}>{signedCurrency(plan.lastMonth.pnl)}</Text>
              {plan.lastMonth.pnlPct !== null && (
                <Text style={[styles.lastMonthPct, { color: plan.lastMonth.pnl >= 0 ? UP : DOWN }]}>{signedPct(plan.lastMonth.pnlPct)}</Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.summaryCols}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Securities value</Text>
            <Text style={styles.summaryNumber}>{formatCurrency(plan.finalValue)}</Text>
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Unrealised P&L</Text>
            <Text style={[styles.summaryNumber, { color: plan.growth >= 0 ? UP : DOWN }]}>{signedCurrency(plan.growth)}</Text>
            {plan.growthPct !== null && <Text style={[styles.summarySmall, { color: plan.growth >= 0 ? UP : DOWN }]}>{signedPct(plan.growthPct)}</Text>}
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Cash balance</Text>
            <Text style={styles.summaryNumber}>{formatCurrency(plan.walletBalance)}</Text>
            {emergencyBuffer !== null && <Text style={styles.summarySmall}>≈ {emergencyBuffer.toFixed(1)}x monthly expenses</Text>}
          </View>
        </View>

        <Text style={styles.summaryFoot}>
          Contributed so far {formatCurrency(plan.totalContributed)} · cash is what's left after contributing each month
        </Text>
      </View>

      {/* 2. Holdings */}
      <View style={styles.card}>
        <Text style={styles.cardHeading}>Your holdings</Text>
        <Text style={styles.cardSub}>
          {plan.portfolioName}
          {plan.portfolioIsPreset ? "" : " (custom)"} · {formatCurrency(plan.contributionAmount)} a month · {plan.monthsRunning} month
          {plan.monthsRunning === 1 ? "" : "s"}
        </Text>

        {holdings.map((h) => (
          <Pressable
            key={h.fundId}
            style={styles.holding}
            onPress={() => navigation.navigate("FundDetail", { fundId: h.fundId, ticker: h.ticker })}
            accessibilityRole="button"
            accessibilityLabel={`${h.ticker} history`}
          >
            <View style={styles.holdingTop}>
              <View style={styles.holdingName}>
                <Text style={styles.ticker}>{h.ticker}</Text>
                <Text style={styles.fundName} numberOfLines={1}>
                  {h.name}
                </Text>
              </View>
              <Text style={styles.holdingValue}>{formatCurrency(h.value)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(Math.max(h.weightPct, 0), 100)}%`, backgroundColor: ASSET_CLASS_COLORS[h.assetClass] ?? "#999" }]} />
            </View>
            <View style={styles.holdingBottom}>
              <Text style={styles.holdingMeta}>
                {ASSET_CLASS_LABELS[h.assetClass] ?? h.assetClass} · {h.currency}
              </Text>
              <Text style={styles.holdingMeta}>{formatWeight(h.weightPct)} of portfolio ›</Text>
            </View>
          </Pressable>
        ))}

        {plan.holdings.length > HOLDINGS_SHOWN && (
          <Pressable onPress={() => setShowAllHoldings((s) => !s)}>
            <Text style={styles.toggleLink}>{showAllHoldings ? `Show top ${HOLDINGS_SHOWN}` : `Show all ${plan.holdings.length} funds`}</Text>
          </Pressable>
        )}

        <Text style={styles.note}>Each fund is valued at its weight of the portfolio; the plan is rebalanced to these weights every month.</Text>
        <Pressable onPress={() => navigation.navigate("Contribution")}>
          <Text style={styles.secondaryButtonText}>Change plan →</Text>
        </Pressable>
      </View>

      {/* 3. Growth, savings rate */}
      {bars.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Growth over time</Text>
          <View style={styles.chart}>
            {bars.map((point) => (
              <View key={point.monthDate} style={[styles.bar, { height: Math.max(4, (point.portfolioValue / maxValue) * 100) }]} />
            ))}
          </View>
          <Text style={styles.chartCaption}>
            {bars[0].monthDate.slice(0, 7)} → {bars[bars.length - 1].monthDate.slice(0, 7)} · {formatCurrency(bars[bars.length - 1].portfolioValue)}
          </Text>
        </View>
      )}

      {profile && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Savings Rate</Text>
          <Text style={styles.bigStat}>{profile.savingsRatePct.toFixed(0)}%</Text>
          <Text style={styles.chartCaption}>(income − expense) / income</Text>
        </View>
      )}

      {/* 4. Account */}
      {account}
    </ScrollView>
  );
}

/** Account management: each row opens its own small screen. */
function AccountSection({
  me,
  onEdit,
  onLogout,
}: {
  me: Me["user"] | null;
  onEdit: (kind: "name" | "email" | "password") => void;
  onLogout: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>Account</Text>
      <AccountRow label="Display name" value={me?.displayName ?? "Not set"} onPress={() => onEdit("name")} />
      <AccountRow label="Email" value={me?.email ?? ""} onPress={() => onEdit("email")} />
      <AccountRow label="Password" value="Change" onPress={() => onEdit("password")} />
      <Pressable style={styles.logoutRow} onPress={onLogout} accessibilityRole="button">
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

function AccountRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={styles.accountRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Change ${label}`}>
      <Text style={styles.accountLabel}>{label}</Text>
      <Text style={styles.accountValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// Evenly samples down to at most `max` points, always keeping the last one
// so the chart's rightmost bar is the true final value.
function downsample(points: GrowthPoint[], max: number): GrowthPoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const sampled: GrowthPoint[] = [];
  for (let i = 0; i < max - 1; i++) {
    sampled.push(points[Math.floor(i * step)]);
  }
  sampled.push(points[points.length - 1]);
  return sampled;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function formatWeight(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load your dashboard. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  headerRow: { width: "100%", maxWidth: 360, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  title: { fontSize: 24, fontWeight: "700" },
  headerSub: { fontSize: 13, color: "#777" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 8, textAlign: "center" },
  error: { color: "#c0392b", textAlign: "center" },

  // summary card
  summaryCard: { width: "100%", maxWidth: 360, backgroundColor: "#1f3b73", borderRadius: 12, padding: 16, gap: 14 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  summaryLabel: { fontSize: 12, color: "#b8c7e6" },
  summaryBig: { fontSize: 30, fontWeight: "700", color: "#fff" },
  lastMonth: { alignItems: "flex-end" },
  lastMonthValue: { fontSize: 16, fontWeight: "700" },
  lastMonthPct: { fontSize: 12, fontWeight: "600" },
  summaryCols: { flexDirection: "row", gap: 8 },
  summaryCol: { flex: 1, gap: 2 },
  summaryNumber: { fontSize: 15, fontWeight: "700", color: "#fff" },
  summarySmall: { fontSize: 11, color: "#b8c7e6" },
  summaryFoot: { fontSize: 11, color: "#b8c7e6" },

  // cards
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 8 },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  cardSub: { fontSize: 12, color: "#777" },
  note: { fontSize: 11, color: "#888" },
  toggleLink: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", paddingVertical: 4 },

  // holdings
  holding: { gap: 4, paddingVertical: 6 },
  holdingTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  holdingName: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  ticker: { fontWeight: "700", color: "#333" },
  fundName: { flex: 1, fontSize: 12, color: "#777" },
  holdingValue: { fontWeight: "700", color: "#333" },
  track: { height: 6, borderRadius: 3, backgroundColor: "#eee", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  holdingBottom: { flexDirection: "row", justifyContent: "space-between" },
  holdingMeta: { fontSize: 11, color: "#999" },

  // growth chart
  chart: { flexDirection: "row", alignItems: "flex-end", height: 100, gap: 3 },
  bar: { flex: 1, backgroundColor: "#2e6fdb", borderRadius: 2, minWidth: 4 },
  chartCaption: { fontSize: 12, color: "#777", marginTop: 4 },
  bigStat: { fontSize: 32, fontWeight: "700", color: "#2e6fdb" },

  // account
  accountRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#eee" },
  accountLabel: { width: 100, color: "#555" },
  accountValue: { flex: 1, color: "#222", textAlign: "right" },
  chevron: { fontSize: 20, color: "#999" },
  logoutRow: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#eee", alignItems: "center" },
  logoutText: { color: LOSS, fontWeight: "600" },

  submitButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 14, alignItems: "center", width: "100%", maxWidth: 360 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
