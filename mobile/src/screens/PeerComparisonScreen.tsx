/**
 * S-05 Peer Comparison — UC-05. Percentile + peer medians, incl. fallback
 * tier used (transparency text per UC-05 step 6, DECISIONS.md #2).
 * NFR-03: only ever renders aggregated stats (percentiles/counts), never
 * raw peer records — matches what GET /peers/summary itself returns.
 *
 * Only calls /peers/summary: its payload (tier, p25/p50/p75, memberCount,
 * plus the user's own value and the transparency message) is a strict
 * superset of what /peers/distribution returns, so a second fetch here
 * would just duplicate the same numbers for this screen's needs.
 * /peers/distribution is still implemented and tested server-side for
 * whatever narrower consumer wants just the group shape.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "PeerComparison">;

interface PeerSummary {
  tier: "FULL" | "RISK_BUDGET" | "RISK_ONLY";
  memberCount: number;
  userValue: number | null;
  p25: number;
  p50: number;
  p75: number;
  message: string;
}

export function PeerComparisonScreen({ navigation }: Props) {
  const [summary, setSummary] = useState<PeerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<PeerSummary>("/peers/summary")
      .then((res) => {
        if (!cancelled) setSummary(res);
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

  if (!summary) {
    return null;
  }

  const hasPeers = summary.memberCount > 0;
  const domainMax = Math.max(summary.p75, summary.userValue ?? 0, 1) * 1.15;

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Peer Comparison</Text>
      <Text style={styles.subtitle}>{summary.message}</Text>

      {!hasPeers && (
        <View style={styles.card}>
          <Text style={styles.body}>No peers to compare against yet — check back once more people join.</Text>
        </View>
      )}

      {hasPeers && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>
            {summary.memberCount} peer{summary.memberCount === 1 ? "" : "s"}
          </Text>

          <View style={styles.track}>
            <View style={[styles.rangeBar, { left: `${pct(summary.p25, domainMax)}%`, width: `${pct(summary.p75, domainMax) - pct(summary.p25, domainMax)}%` }]} />
            <Marker position={pct(summary.p50, domainMax)} color="#555" />
            {summary.userValue !== null && <Marker position={pct(summary.userValue, domainMax)} color="#2e6fdb" filled />}
          </View>

          <View style={styles.legendRow}>
            <LegendItem color="#555" label={`Median: ${formatCurrency(summary.p50)}`} />
            {summary.userValue !== null && <LegendItem color="#2e6fdb" label={`You: ${formatCurrency(summary.userValue)}`} />}
          </View>

          <View style={styles.percentileRow}>
            <PercentileStat label="25th pct" value={summary.p25} />
            <PercentileStat label="Median" value={summary.p50} />
            <PercentileStat label="75th pct" value={summary.p75} />
          </View>
        </View>
      )}

      {summary.userValue === null && (
        <View style={styles.card}>
          <Text style={styles.body}>Run a simulation to see how you compare.</Text>
          <Pressable style={styles.submitButton} onPress={() => navigation.navigate("SimulationSetup")}>
            <Text style={styles.submitButtonText}>Run a simulation</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function Marker({ position, color, filled }: { position: number; color: string; filled?: boolean }) {
  return (
    <View
      style={[
        styles.marker,
        { left: `${position}%`, backgroundColor: filled ? color : "transparent", borderColor: color },
      ]}
    />
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function PercentileStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.percentileStat}>
      <Text style={styles.percentileValue}>{formatCurrency(value)}</Text>
      <Text style={styles.percentileLabel}>{label}</Text>
    </View>
  );
}

function pct(value: number, domainMax: number): number {
  return domainMax > 0 ? Math.min(100, Math.max(0, (value / domainMax) * 100)) : 0;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load your peer comparison. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 8, textAlign: "center" },
  body: { fontSize: 14, color: "#555", textAlign: "center" },
  error: { color: "#c0392b", textAlign: "center" },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  track: {
    height: 8,
    backgroundColor: "#eee",
    borderRadius: 4,
    marginTop: 8,
  },
  rangeBar: {
    position: "absolute",
    height: 8,
    backgroundColor: "#cddcf7",
    borderRadius: 4,
  },
  marker: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginLeft: -8,
  },
  legendRow: { flexDirection: "row", gap: 16, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 12, color: "#555" },
  percentileRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  percentileStat: { alignItems: "center" },
  percentileValue: { fontWeight: "600" },
  percentileLabel: { fontSize: 12, color: "#777" },
  submitButton: {
    backgroundColor: "#2e6fdb",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
