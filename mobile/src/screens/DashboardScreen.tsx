/**
 * S-04 Dashboard — UC-04, UC-07. Performance summary, growth chart, and
 * consistency behaviour, sourced from the most recent simulation run
 * (dashboard.service.ts — there's no persistent portfolio beyond
 * individual simulation runs, so "summary"/"growth" both report on the
 * latest one rather than a cross-run aggregate). NFR-01: target <2s load.
 *
 * Simulation history (/simulation/history, FR13) is Phase 7 and still a
 * 501 stub server-side — not wired here.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Dashboard">;

interface DashboardSummary {
  hasSimulations: boolean;
  totalSimulations: number;
  latestSimulation: {
    simulationId: string;
    templateName: string;
    finalValue: number;
    totalContributed: number;
    growth: number;
    createdAt: string;
  } | null;
}

interface GrowthPoint {
  periodIndex: number;
  portfolioValue: number;
}

interface DashboardGrowth {
  simulationId: string | null;
  templateName: string | null;
  points: GrowthPoint[];
}

interface DashboardBehaviour {
  consistencyScore: number;
  monthsWithActivity: number;
  monthsSinceFirstRun: number;
}

const MAX_BARS = 16;

export function DashboardScreen({ navigation }: Props) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [growth, setGrowth] = useState<DashboardGrowth | null>(null);
  const [behaviour, setBehaviour] = useState<DashboardBehaviour | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<DashboardSummary>("/dashboard/summary"),
      apiFetch<DashboardGrowth>("/dashboard/growth"),
      apiFetch<DashboardBehaviour>("/dashboard/behaviour"),
    ])
      .then(([summaryRes, growthRes, behaviourRes]) => {
        if (cancelled) return;
        setSummary(summaryRes);
        setGrowth(growthRes);
        setBehaviour(behaviourRes);
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

  useEffect(() => load(), [load]);

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

  if (!summary?.hasSimulations || !summary.latestSimulation) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No simulations yet</Text>
        <Text style={styles.subtitle}>Run one to see your dashboard.</Text>
        <Pressable style={styles.submitButton} onPress={() => navigation.navigate("SimulationSetup")}>
          <Text style={styles.submitButtonText}>Run a simulation</Text>
        </Pressable>
      </View>
    );
  }

  const { latestSimulation } = summary;
  const bars = downsample(growth?.points ?? [], MAX_BARS);
  const maxValue = Math.max(...bars.map((b) => b.portfolioValue), 1);

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>
        {summary.totalSimulations} simulation{summary.totalSimulations === 1 ? "" : "s"} run
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>{latestSimulation.templateName}</Text>
        <SummaryRow label="Total contributed" value={formatCurrency(latestSimulation.totalContributed)} />
        <SummaryRow label="Growth" value={formatCurrency(latestSimulation.growth)} />
        <SummaryRow label="Final value" value={formatCurrency(latestSimulation.finalValue)} emphasized />
      </View>

      {bars.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Growth over time</Text>
          <View style={styles.chart}>
            {bars.map((point) => (
              <View
                key={point.periodIndex}
                style={[styles.bar, { height: Math.max(4, (point.portfolioValue / maxValue) * 100) }]}
              />
            ))}
          </View>
          <Text style={styles.chartCaption}>
            Period 0 → {bars[bars.length - 1].periodIndex} · {formatCurrency(bars[bars.length - 1].portfolioValue)}
          </Text>
        </View>
      )}

      {behaviour && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Consistency</Text>
          <Text style={styles.consistencyScore}>{behaviour.consistencyScore.toFixed(0)}%</Text>
          <Text style={styles.chartCaption}>
            Active in {behaviour.monthsWithActivity} of {behaviour.monthsSinceFirstRun} month
            {behaviour.monthsSinceFirstRun === 1 ? "" : "s"} since your first simulation
          </Text>
        </View>
      )}

      <Pressable style={styles.submitButton} onPress={() => navigation.navigate("SimulationSetup")}>
        <Text style={styles.submitButtonText}>Run another simulation</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("PeerComparison")}>
        <Text style={styles.secondaryButtonText}>Compare with peers</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Insights")}>
        <Text style={styles.secondaryButtonText}>View insights</Text>
      </Pressable>
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
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 8, textAlign: "center" },
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
  consistencyScore: { fontSize: 32, fontWeight: "700", color: "#2e6fdb" },
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
