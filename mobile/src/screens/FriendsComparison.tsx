/**
 * Friends comparison — the "Friends" half of the Peers tab (DECISIONS.md
 * #8, 3 Oct 2026). A ranked list, per metric, of the user plus the friends
 * who have chosen to share that metric (GET /friends/comparison). This is
 * the one place named individuals appear, as a consent-based exception to
 * NFR-03 — the anonymous income-range comparison next to it is untouched.
 *
 * The user always sees their own figure; a friend's metric appears only if
 * they opted in, and friends who hide it are counted but never named.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";

type MetricKey = "value" | "returnPct" | "contributionRatePct" | "savingsRatePct" | "emergencyBuffer";

interface BoardRow {
  displayName: string;
  isMe: boolean;
  value: number;
  rank: number;
}

interface MetricBoard {
  rows: BoardRow[];
  hiddenCount: number;
  noDataCount: number;
}

interface Comparison {
  friendCount: number;
  metrics: Record<MetricKey, MetricBoard>;
}

const METRICS: { key: MetricKey; label: string; format: (v: number) => string }[] = [
  { key: "value", label: "Value", format: formatCurrency },
  { key: "returnPct", label: "Return", format: (v) => `${v.toFixed(1)}%` },
  { key: "contributionRatePct", label: "Contribution rate", format: (v) => `${v.toFixed(1)}%` },
  { key: "savingsRatePct", label: "Savings rate", format: (v) => `${v.toFixed(1)}%` },
  { key: "emergencyBuffer", label: "Emergency buffer", format: (v) => `${v.toFixed(1)}x` },
];

export function FriendsComparison({ onManage }: { onManage: () => void }) {
  const [data, setData] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("value");

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<Comparison>("/friends/comparison")
      .then((res) => {
        if (!cancelled) setData(res);
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

  if (error || !data) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error ?? "Couldn't load your friends comparison."}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (data.friendCount === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Friends</Text>
        <Text style={styles.subtitle}>
          Add friends to see how you compare with people you know. You choose exactly which of your stats they can see.
        </Text>
        <Pressable style={styles.submitButton} onPress={onManage}>
          <Text style={styles.submitButtonText}>Add friends</Text>
        </Pressable>
      </View>
    );
  }

  const selected = METRICS.find((m) => m.key === metric)!;
  const board = data.metrics[metric];

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Friends</Text>
      <Text style={styles.subtitle}>
        {data.friendCount} friend{data.friendCount === 1 ? "" : "s"} · only stats each friend has chosen to share are shown.
      </Text>

      <View style={styles.chipWrap}>
        {METRICS.map((m) => (
          <Pressable key={m.key} style={[styles.chip, metric === m.key && styles.chipSelected]} onPress={() => setMetric(m.key)}>
            <Text style={[styles.chipText, metric === m.key && styles.chipTextSelected]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>{selected.label}</Text>

        {board.rows.length === 0 && <Text style={styles.body}>Nothing to rank yet for this stat.</Text>}

        {board.rows.map((row, i) => (
          <View key={`${row.displayName}-${i}`} style={[styles.row, row.isMe && styles.rowMe]}>
            <Text style={[styles.rank, row.isMe && styles.rowMeText]}>{row.rank}</Text>
            <Text style={[styles.name, row.isMe && styles.rowMeText]} numberOfLines={1}>
              {row.isMe ? `${row.displayName} (you)` : row.displayName}
            </Text>
            <Text style={[styles.value, row.isMe && styles.rowMeText]}>{selected.format(row.value)}</Text>
          </View>
        ))}

        {board.hiddenCount > 0 && (
          <Text style={styles.note}>
            {board.hiddenCount} friend{board.hiddenCount === 1 ? " doesn't" : "s don't"} share this stat.
          </Text>
        )}
        {board.noDataCount > 0 && (
          <Text style={styles.note}>
            {board.noDataCount} friend{board.noDataCount === 1 ? " has" : "s have"} no figure yet.
          </Text>
        )}
      </View>

      <Pressable style={styles.secondaryButton} onPress={onManage}>
        <Text style={styles.secondaryButtonText}>Manage friends & sharing →</Text>
      </Pressable>
    </ScrollView>
  );
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load your friends comparison. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 8, textAlign: "center", maxWidth: 360 },
  body: { fontSize: 14, color: "#555", textAlign: "center" },
  error: { color: "#c0392b", textAlign: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 360 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#2e6fdb", fontWeight: "600" },
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 6 },
  rowMe: { backgroundColor: "#eaf1fd" },
  rowMeText: { color: "#2e6fdb", fontWeight: "700" },
  rank: { width: 24, fontWeight: "600", color: "#555" },
  name: { flex: 1, color: "#333" },
  value: { fontWeight: "600", color: "#333" },
  note: { fontSize: 12, color: "#777", marginTop: 4 },
  submitButton: {
    backgroundColor: "#2e6fdb",
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
