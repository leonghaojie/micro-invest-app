/**
 * S-05 Peer Comparison — UC-05, rewritten for DECISIONS.md #2's
 * income-range peer grouping and the new Savings Rate / Emergency Buffer
 * metrics (25 Aug 2026). Three percentile tracks now instead of one:
 * portfolio value, Savings Rate, Emergency Buffer — same visual pattern
 * (range bar + median marker + user marker) reused for all three.
 * NFR-03: only ever renders aggregated stats, never raw peer records —
 * matches what GET /peers/summary itself returns.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import type { MainTabScreenProps } from "../navigation/AppNavigator";

type Props = MainTabScreenProps<"PeerComparison">;

interface MetricStats {
  userValue: number | null;
  p25: number;
  p50: number;
  p75: number;
}

interface PeerSummary {
  bandPct: number | null;
  memberCount: number;
  message: string;
  value: MetricStats;
  savingsRatePct: MetricStats;
  emergencyBuffer: MetricStats;
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

  useFocusEffect(load);

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
        <>
          <MetricCard title={`${summary.memberCount} peer${summary.memberCount === 1 ? "" : "s"} — Portfolio value`} stats={summary.value} format={formatCurrency} />
          <MetricCard title="Savings Rate" stats={summary.savingsRatePct} format={(v) => `${v.toFixed(0)}%`} />
          <MetricCard title="Emergency Buffer" stats={summary.emergencyBuffer} format={(v) => `${v.toFixed(1)}x`} />
        </>
      )}

      {summary.value.userValue === null && (
        <View style={styles.card}>
          <Text style={styles.body}>Start a plan to see how you compare.</Text>
          <Pressable style={styles.submitButton} onPress={() => navigation.navigate("Contribution")}>
            <Text style={styles.submitButtonText}>Start a plan</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function MetricCard({ title, stats, format }: { title: string; stats: MetricStats; format: (v: number) => string }) {
  const domainMax = Math.max(stats.p75, stats.userValue ?? 0, 0.01) * 1.15;

  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>{title}</Text>

      <View style={styles.track}>
        <View
          style={[
            styles.rangeBar,
            { left: `${pct(stats.p25, domainMax)}%`, width: `${pct(stats.p75, domainMax) - pct(stats.p25, domainMax)}%` },
          ]}
        />
        <Marker position={pct(stats.p50, domainMax)} color="#555" />
        {stats.userValue !== null && <Marker position={pct(stats.userValue, domainMax)} color="#2e6fdb" filled />}
      </View>

      <View style={styles.legendRow}>
        <LegendItem color="#555" label={`Median: ${format(stats.p50)}`} />
        {stats.userValue !== null && <LegendItem color="#2e6fdb" label={`You: ${format(stats.userValue)}`} />}
      </View>

      <View style={styles.percentileRow}>
        <PercentileStat label="25th pct" value={stats.p25} format={format} />
        <PercentileStat label="Median" value={stats.p50} format={format} />
        <PercentileStat label="75th pct" value={stats.p75} format={format} />
      </View>
    </View>
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

function PercentileStat({ label, value, format }: { label: string; value: number; format: (v: number) => string }) {
  return (
    <View style={styles.percentileStat}>
      <Text style={styles.percentileValue}>{format(value)}</Text>
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
