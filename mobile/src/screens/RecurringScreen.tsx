/**
 * Monthly buys (DECISIONS.md #19): the standing instructions that buy a fixed amount of a fund
 * or portfolio at the start of each month. From here the user can change an amount, pause and
 * resume; a new one is set up from a fund's or a portfolio's Buy screen ("Every month").
 *
 * A month the cash did not cover is shown as skipped, never hidden, and it counts against
 * contribution consistency (the share of recent months in which the user bought something),
 * which is shown at the top.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackScreenProps } from "../navigation/AppNavigator";
import { formatCurrency } from "../utils/peerFormat";

type Props = RootStackScreenProps<"Recurring">;

interface Rule {
  id: string;
  kind: "FUND" | "PORTFOLIO";
  targetName: string;
  amount: number;
  status: "ACTIVE" | "PAUSED";
  startMonth: string;
  endMonth: string | null;
  runs: { month: string; status: "BOUGHT" | "SKIPPED" }[];
}

interface Overview {
  tradeMonth: string | null;
  rules: Rule[];
  consistency: { monthsWithBuy: number; monthsCounted: number; pct: number } | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longMonth = (m: string) => `${MONTH_NAMES[Number(m.split("-")[1]) - 1]} ${m.split("-")[0]}`;
const shortMonth = (m: string) => MONTH_NAMES[Number(m.split("-")[1]) - 1];

export function RecurringScreen({ navigation }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // the rule being acted on
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [ruleError, setRuleError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    apiFetch<Overview>("/recurring")
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  async function act(rule: Rule, what: "pause" | "resume" | "change") {
    setRuleError(null);
    if (what === "change") {
      const value = Number(amount);
      if (!amount.trim() || !Number.isFinite(value) || value < 1) {
        setRuleError({ id: rule.id, message: "Enter an amount of at least $1." });
        return;
      }
    }
    setBusy(rule.id);
    try {
      if (what === "change") await apiFetch(`/recurring/${rule.id}`, { method: "PUT", body: { amount: Number(amount) } });
      else await apiFetch(`/recurring/${rule.id}/${what}`, { method: "POST" });
      setEditing(null);
      setAmount("");
      load();
    } catch (err) {
      setRuleError({ id: rule.id, message: describeError(err) });
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  const { consistency, rules, tradeMonth } = data;

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Monthly buys</Text>
      <Text style={styles.subtitle}>Buy a fixed amount at the start of each month. A month without enough cash is skipped.</Text>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>How regularly you invest</Text>
        {consistency ? (
          <>
            <Text style={styles.bigStat}>{consistency.pct.toFixed(consistency.pct % 1 === 0 ? 0 : 1)}%</Text>
            <Text style={styles.body}>
              You bought something in {consistency.monthsWithBuy} of the last {consistency.monthsCounted} month{consistency.monthsCounted === 1 ? "" : "s"}.
            </Text>
            <Text style={styles.hint}>A month with no buy counts against it, including a monthly buy skipped for lack of cash.</Text>
          </>
        ) : (
          <Text style={styles.body}>Shown once you have invested for 3 months.</Text>
        )}
      </View>

      {rules.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>No monthly buys yet</Text>
          <Text style={styles.body}>Open a fund or a portfolio, choose Buy, then "Every month".</Text>
        </View>
      )}

      {rules.map((r) => {
        const upcoming = r.status === "ACTIVE" && tradeMonth !== null && r.startMonth > tradeMonth;
        return (
          <View key={r.id} style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.ruleName} numberOfLines={2}>
                {r.targetName}
              </Text>
              <View style={[styles.badge, r.status === "ACTIVE" ? styles.badgeOn : styles.badgeOff]}>
                <Text style={[styles.badgeText, r.status === "ACTIVE" ? styles.badgeTextOn : styles.badgeTextOff]}>{r.status === "ACTIVE" ? "Running" : "Paused"}</Text>
              </View>
            </View>
            <Text style={styles.ruleAmount}>{formatCurrency(r.amount)} a month</Text>
            {upcoming && <Text style={styles.hint}>Starts {longMonth(r.startMonth)}</Text>}

            {r.runs.length > 0 && (
              <View style={styles.runs}>
                {r.runs.map((run) => (
                  <View key={run.month} style={[styles.run, run.status === "BOUGHT" ? styles.runOk : styles.runSkipped]}>
                    <Text style={[styles.runText, run.status === "BOUGHT" ? styles.runTextOk : styles.runTextSkipped]}>
                      {shortMonth(run.month)} {run.status === "BOUGHT" ? "bought" : "skipped"}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {editing === r.id ? (
              <View style={styles.editRow}>
                <TextInput style={styles.input} placeholder="New amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} accessibilityLabel="New monthly amount" />
                <Pressable style={styles.saveButton} onPress={() => act(r, "change")} disabled={busy === r.id}>
                  {busy === r.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
                </Pressable>
              </View>
            ) : (
              <View style={styles.actions}>
                {r.status === "ACTIVE" ? (
                  <>
                    <Pressable onPress={() => { setEditing(r.id); setAmount(String(r.amount)); setRuleError(null); }} disabled={busy === r.id || upcoming} accessibilityRole="button" accessibilityLabel={`Change amount of ${r.targetName}`}>
                      <Text style={[styles.action, upcoming && styles.actionOff]}>Change amount</Text>
                    </Pressable>
                    <Pressable onPress={() => act(r, "pause")} disabled={busy === r.id} accessibilityRole="button" accessibilityLabel={`Pause ${r.targetName}`}>
                      <Text style={styles.actionWarn}>Pause</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => act(r, "resume")} disabled={busy === r.id} accessibilityRole="button" accessibilityLabel={`Resume ${r.targetName}`}>
                    <Text style={styles.action}>Resume</Text>
                  </Pressable>
                )}
              </View>
            )}
            {editing === r.id && (
              <Pressable onPress={() => setEditing(null)}>
                <Text style={styles.hint}>Cancel. A new amount applies from next month.</Text>
              </Pressable>
            )}
            {ruleError?.id === r.id && <Text style={styles.error}>{ruleError.message}</Text>}
          </View>
        );
      })}

      <View style={styles.setup}>
        <Text style={styles.hint}>Set up a new one:</Text>
        <View style={styles.actions}>
          <Pressable onPress={() => navigation.navigate("Main", { screen: "Contribution" })}>
            <Text style={styles.action}>Choose a portfolio</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate("Main", { screen: "Funds" })}>
            <Text style={styles.action}>Choose a fund</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Something went wrong. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", textAlign: "center", maxWidth: 340 },
  error: { color: "#c0392b", textAlign: "center" },
  link: { color: "#2e6fdb", fontWeight: "600" },
  body: { fontSize: 14, color: "#555" },
  hint: { fontSize: 12, color: "#777" },
  bigStat: { fontSize: 32, fontWeight: "700", color: "#2e6fdb" },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 8 },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  ruleName: { flex: 1, fontSize: 15, fontWeight: "600", color: "#333" },
  ruleAmount: { fontSize: 18, fontWeight: "700", color: "#2e6fdb" },
  badge: { borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 },
  badgeOn: { backgroundColor: "#e6f6ec" },
  badgeOff: { backgroundColor: "#f1f1f1" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeTextOn: { color: "#1a8f4c" },
  badgeTextOff: { color: "#777" },
  runs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  run: { borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 },
  runOk: { backgroundColor: "#e6f6ec" },
  runSkipped: { backgroundColor: "#fdf1dc" },
  runText: { fontSize: 11, fontWeight: "600" },
  runTextOk: { color: "#1a8f4c" },
  runTextSkipped: { color: "#b9770e" },
  actions: { flexDirection: "row", gap: 24, marginTop: 4 },
  action: { color: "#2e6fdb", fontWeight: "600" },
  actionOff: { opacity: 0.4 },
  actionWarn: { color: "#c0392b", fontWeight: "600" },
  editRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  saveButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  saveText: { color: "#fff", fontWeight: "700" },
  setup: { width: "100%", maxWidth: 360, gap: 4 },
});
