/**
 * S-04 Dashboard — UC-04. Performance summary, growth chart, wallet, and
 * Savings Rate, sourced from the user's one active Plan (plan.service.ts)
 * and profile (DECISIONS.md #1 third amendment / new metrics entry, 25
 * Aug 2026). NFR-01: target <2s load.
 *
 * The old Consistency card is gone — see dashboard.service.ts's header for
 * why (ConsistencyScore measured user-initiated simulation runs, which no
 * longer exist now that a plan is an automatic monthly backtest). Wallet
 * (liquid cash left after contributing) and Savings Rate take its place.
 *
 * UI restructuring (20 Aug 2026, unchanged by this amendment): this is the
 * tab bar's home tab. Data reloads on every focus.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError, clearStoredAuthToken } from "../api/client";
import type { MainTabScreenProps, RootStackParamList } from "../navigation/AppNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type Props = MainTabScreenProps<"Dashboard">;

interface DashboardSummary {
  hasPlan: boolean;
  latestPlan: {
    planId: string;
    portfolioName: string;
    startMonth: string;
    finalValue: number;
    totalContributed: number;
    growth: number;
    walletBalance: number;
  } | null;
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

const MAX_BARS = 16;

export function DashboardScreen({ navigation }: Props) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [growth, setGrowth] = useState<DashboardGrowth | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<DashboardSummary>("/dashboard/summary"),
      apiFetch<DashboardGrowth>("/dashboard/growth"),
      apiFetch<ProfileResponse>("/user/profile").catch(() => null),
    ])
      .then(([summaryRes, growthRes, profileRes]) => {
        if (cancelled) return;
        setSummary(summaryRes);
        setGrowth(growthRes);
        setProfile(profileRes);
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

  if (loading) {
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
      </View>
    );
  }

  if (!summary?.hasPlan || !summary.latestPlan) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No plan yet</Text>
        <Text style={styles.subtitle}>Start a plan to see your dashboard.</Text>
        <Pressable style={styles.submitButton} onPress={() => navigation.navigate("Contribution")}>
          <Text style={styles.submitButtonText}>Start your plan</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={handleLogout}>
          <Text style={styles.secondaryButtonText}>Log out</Text>
        </Pressable>
      </View>
    );
  }

  const { latestPlan } = summary;
  const bars = downsample(growth?.points ?? [], MAX_BARS);
  const maxValue = Math.max(...bars.map((b) => b.portfolioValue), 1);
  const emergencyBuffer = profile && profile.monthlyExpense > 0 ? latestPlan.walletBalance / profile.monthlyExpense : null;

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Since {latestPlan.startMonth.slice(0, 7)}</Text>
        </View>
        <Pressable onPress={handleLogout}>
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>{latestPlan.portfolioName}</Text>
        <SummaryRow label="Total contributed" value={formatCurrency(latestPlan.totalContributed)} />
        <SummaryRow label="Growth" value={formatCurrency(latestPlan.growth)} />
        <SummaryRow label="Final value" value={formatCurrency(latestPlan.finalValue)} emphasized />
      </View>

      {bars.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Growth over time</Text>
          <View style={styles.chart}>
            {bars.map((point) => (
              <View
                key={point.monthDate}
                style={[styles.bar, { height: Math.max(4, (point.portfolioValue / maxValue) * 100) }]}
              />
            ))}
          </View>
          <Text style={styles.chartCaption}>
            {bars[0].monthDate.slice(0, 7)} → {bars[bars.length - 1].monthDate.slice(0, 7)} ·{" "}
            {formatCurrency(bars[bars.length - 1].portfolioValue)}
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Wallet</Text>
        <Text style={styles.bigStat}>{formatCurrency(latestPlan.walletBalance)}</Text>
        <Text style={styles.chartCaption}>
          Liquid cash left over after contributing (income − expense − contribution, accumulated monthly).
          {emergencyBuffer !== null && ` Covers about ${emergencyBuffer.toFixed(1)}x your monthly expenses.`}
        </Text>
      </View>

      {profile && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Savings Rate</Text>
          <Text style={styles.bigStat}>{profile.savingsRatePct.toFixed(0)}%</Text>
          <Text style={styles.chartCaption}>(income − expense) / income</Text>
        </View>
      )}
    </ScrollView>
  );
}

function SummaryRow({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, emphasized && styles.summaryValueEmphasized]}>{value}</Text>
    </View>
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
  headerRow: {
    width: "100%",
    maxWidth: 360,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 8, textAlign: "center" },
  logoutText: { color: "#c0392b", fontSize: 13, marginTop: 4 },
  error: { color: "#c0392b", textAlign: "center" },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { color: "#555" },
  summaryValue: { fontWeight: "600" },
  summaryValueEmphasized: { fontSize: 18, color: "#2e6fdb" },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 100,
    gap: 3,
  },
  bar: { flex: 1, backgroundColor: "#2e6fdb", borderRadius: 2, minWidth: 4 },
  chartCaption: { fontSize: 12, color: "#777", marginTop: 4 },
  bigStat: { fontSize: 32, fontWeight: "700", color: "#2e6fdb" },
  submitButton: {
    backgroundColor: "#2e6fdb",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
  },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
