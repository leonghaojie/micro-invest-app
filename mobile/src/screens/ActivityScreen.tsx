/**
 * Activity — the account's history (DECISIONS.md #19): buys, sells and the monthly cash
 * credits, newest first. Read-only; GET /trades.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { formatCurrency } from "../utils/peerFormat";

interface Item {
  kind: "BUY" | "SELL" | "CREDIT" | "SKIPPED";
  month: string;
  amount: number;
  source: string;
  ticker: string | null;
  name: string | null;
  batchId: string | null;
  at: string;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longMonth = (m: string) => `${MONTH_NAMES[Number(m.split("-")[1]) - 1]} ${m.split("-")[0]}`;

const SOURCE_NOTE: Record<string, string> = { RECURRING: "monthly buy", MIGRATED: "from your earlier plan", SETUP: "opening cash", MONTHLY: "monthly cash" };

export function ActivityScreen() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    apiFetch<{ items: Item[] }>("/trades?limit=100")
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? ((err.body as { error?: string } | undefined)?.error ?? "Couldn't load your activity.") : "Could not reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!items) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>Nothing yet. Your buys, sells and monthly cash will show up here.</Text>
      </View>
    );
  }

  // Legs of one basket buy share a batch, and a migrated month's buys share a month: show each as one line.
  const rows: { key: string; kind: Item["kind"]; month: string; title: string; note: string; amount: number }[] = [];
  const seenGroup = new Map<string, number>();
  items.forEach((it, i) => {
    const group = it.kind === "CREDIT" || it.kind === "SKIPPED" ? null : (it.batchId ?? (it.source === "MIGRATED" ? `${it.kind}-${it.month}-migrated` : null));
    if (group && seenGroup.has(group)) {
      const row = rows[seenGroup.get(group)!];
      row.amount += it.amount;
      row.title = `${it.kind === "BUY" ? "Bought" : "Sold"} several funds`;
      return;
    }
    if (group) seenGroup.set(group, rows.length);
    rows.push({
      key: `${i}-${it.at}`,
      kind: it.kind,
      month: it.month,
      title:
        it.kind === "CREDIT"
          ? "Cash added"
          : it.kind === "SKIPPED"
            ? `Monthly buy skipped: ${it.ticker ?? it.name ?? ""}`.trim()
            : `${it.kind === "BUY" ? "Bought" : "Sold"} ${it.ticker}`,
      note: it.kind === "SKIPPED" ? "not enough cash that month" : (SOURCE_NOTE[it.source] ?? ""),
      amount: it.amount,
    });
  });

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.card}>
        {rows.map((r) => (
          <View key={r.key} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{r.title}</Text>
              <Text style={styles.rowMeta}>
                {longMonth(r.month)}
                {r.note ? ` · ${r.note}` : ""}
              </Text>
            </View>
            {r.kind === "SKIPPED" ? (
              <Text style={styles.skipped}>{formatCurrency(r.amount)} not bought</Text>
            ) : (
              <Text style={[styles.amount, r.kind === "BUY" ? styles.out : styles.in]}>
                {r.kind === "BUY" ? "-" : "+"}
                {formatCurrency(r.amount)}
              </Text>
            )}
          </View>
        ))}
      </View>
      <Text style={styles.foot}>Amounts are the effect on your cash: buys take it out; sells and monthly cash add to it.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  subtitle: { fontSize: 14, color: "#555", textAlign: "center", maxWidth: 320 },
  error: { color: "#c0392b", textAlign: "center" },
  link: { color: "#2e6fdb", fontWeight: "600" },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: "600", color: "#333" },
  rowMeta: { fontSize: 12, color: "#777" },
  amount: { fontWeight: "700" },
  skipped: { fontSize: 12, color: "#b9770e", fontWeight: "600" },
  out: { color: "#c0392b" },
  in: { color: "#1a8f4c" },
  foot: { fontSize: 11, color: "#999", textAlign: "center", maxWidth: 340 },
});
