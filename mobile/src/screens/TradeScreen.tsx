/**
 * Trade — buy or sell a fund, or buy a portfolio (DECISIONS.md #19). Reached from a fund's
 * screen (Buy / Sell) and from the Portfolios tab (Buy).
 *
 * Trades are in dollars. They are made in the trade month (the month after the latest data),
 * priced at the latest month-end, and start earning from the trade month's return once that
 * month's data arrives; until then they are valued at cost. The screen says so, because it is
 * the one thing that is not like a live brokerage.
 *
 * A buy can be made once or "every month" (a monthly buy: POST /recurring). A monthly buy makes
 * its first purchase now if the cash is there, then runs at the start of each month; a month
 * without enough cash is skipped and shown as skipped.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { KeyboardScreen } from "../components/KeyboardScreen";
import type { RootStackScreenProps } from "../navigation/AppNavigator";
import { formatCurrency } from "../utils/peerFormat";

type Props = RootStackScreenProps<"Trade">;

interface Summary {
  hasPlan: boolean;
  latestPlan: {
    walletBalance: number;
    tradeMonth: string;
    latestDataMonth: string;
    holdings: { fundId: string; value: number }[];
  } | null;
}

interface PortfolioSummary {
  id: string;
  allocations: { ticker: string; weightPct: number }[];
}

interface MonthlyResult {
  rule: { amount: number; targetName: string };
  firstRun: "BOUGHT" | "SKIPPED" | null;
  cash: number;
}

interface TradeResult {
  side: "BUY" | "SELL";
  tradeMonth: string;
  legs: { fundId: string; ticker: string; name: string; amount: number }[];
  total: number;
  cash: number;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09" -> "Sep 2026" */
const longMonth = (m: string) => `${MONTH_NAMES[Number(m.split("-")[1]) - 1]} ${m.split("-")[0]}`;

export function TradeScreen({ route, navigation }: Props) {
  const { mode, name, fundId, portfolioId } = route.params;
  const isBuy = mode === "buy";
  const [monthly, setMonthly] = useState(Boolean(route.params.monthly));
  const [monthlyResult, setMonthlyResult] = useState<MonthlyResult | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TradeResult | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      apiFetch<Summary>("/dashboard/summary"),
      portfolioId ? apiFetch<PortfolioSummary[]>("/portfolio/portfolios") : Promise.resolve(null),
    ])
      .then(([s, pfs]) => {
        if (cancelled) return;
        setSummary(s);
        setPortfolio(pfs?.find((p) => p.id === portfolioId) ?? null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  useFocusEffect(load);

  if (loading && !summary) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (loadError || !summary) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{loadError ?? "Couldn't load your account."}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const plan = summary.latestPlan;
  if (!plan) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>Set up your profile first, so there is cash to invest.</Text>
        <Pressable style={styles.submitButton} onPress={() => navigation.replace("ProfileSetup")}>
          <Text style={styles.submitButtonText}>Set up profile</Text>
        </Pressable>
      </View>
    );
  }

  const cash = plan.walletBalance;
  const held = fundId ? plan.holdings.find((h) => h.fundId === fundId)?.value ?? 0 : 0;
  const limit = isBuy ? cash : held;
  const parsed = Number(amount);

  function validate(): string | null {
    if (!amount.trim() || !Number.isFinite(parsed) || parsed <= 0) return "Enter an amount.";
    if (parsed < 1) return isBuy && monthly ? "The smallest monthly buy is $1." : "The smallest trade is $1.";
    // A monthly buy may be more than today's cash (months without enough are skipped); the server caps it.
    if (isBuy && monthly) return parsed > 100000 ? "The largest monthly buy is $100,000." : null;
    if (Math.round(parsed * 100) > Math.round(limit * 100)) {
      return isBuy ? `You only have ${formatCurrency(cash)} in cash.` : `You hold ${formatCurrency(held)} of this fund.`;
    }
    return null;
  }

  async function submit(sellAll = false) {
    const problem = sellAll ? null : validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (isBuy && monthly) {
        const res = await apiFetch<MonthlyResult>("/recurring", { method: "POST", body: { ...(fundId ? { fundId } : { portfolioId }), amount: parsed } });
        setMonthlyResult(res);
        return;
      }
      const res = await apiFetch<TradeResult>(isBuy ? "/trades/buy" : "/trades/sell", {
        method: "POST",
        body: isBuy
          ? { ...(fundId ? { fundId } : { portfolioId }), amount: parsed }
          : sellAll
            ? { fundId, all: true }
            : { fundId, amount: parsed },
      });
      setResult(res);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (monthlyResult) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Monthly buy set up</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{monthlyResult.rule.targetName}</Text>
            <Text style={styles.rowValue}>{formatCurrency(monthlyResult.rule.amount)} a month</Text>
          </View>
          <View style={[styles.row, styles.rowTop]}>
            <Text style={styles.rowLabel}>This month</Text>
            <Text style={styles.rowValue}>{monthlyResult.firstRun === "BOUGHT" ? "Bought now" : "Skipped: not enough cash"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Cash now</Text>
            <Text style={styles.rowValue}>{formatCurrency(monthlyResult.cash)}</Text>
          </View>
        </View>
        <Text style={styles.note}>
          It buys again at the start of each month. A month without enough cash is skipped and shown as skipped. You can change the amount or pause it any time.
        </Text>
        <Pressable style={styles.submitButton} onPress={() => navigation.replace("Recurring")}>
          <Text style={styles.submitButtonText}>See monthly buys</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  if (result) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{result.side === "BUY" ? "Bought" : "Sold"} {formatCurrency(result.total)}</Text>
        <View style={styles.card}>
          {result.legs.map((l) => (
            <View key={l.fundId} style={styles.row}>
              <Text style={styles.rowLabel}>
                {l.ticker} · {l.name}
              </Text>
              <Text style={styles.rowValue}>{formatCurrency(l.amount)}</Text>
            </View>
          ))}
          <View style={[styles.row, styles.rowTop]}>
            <Text style={styles.rowLabel}>Cash now</Text>
            <Text style={styles.rowValue}>{formatCurrency(result.cash)}</Text>
          </View>
        </View>
        {result.side === "BUY" && (
          <Text style={styles.note}>
            It shows at cost until {longMonth(result.tradeMonth)}'s fund data arrives; from then on it earns that month's return.
          </Text>
        )}
        <Pressable style={styles.submitButton} onPress={() => navigation.navigate("Main", { screen: "Dashboard" })}>
          <Text style={styles.submitButtonText}>View dashboard</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const chips = isBuy
    ? [
        { label: "$50", value: 50 },
        { label: "$100", value: 100 },
        { label: "$250", value: 250 },
        { label: "All cash", value: cash },
      ]
    : [
        { label: "25%", value: held * 0.25 },
        { label: "50%", value: held * 0.5 },
        { label: "All", value: held },
      ];

  return (
    <KeyboardScreen contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>
        {isBuy ? "Buy" : "Sell"} {name}
      </Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{isBuy ? "Cash available" : "You hold"}</Text>
          <Text style={styles.rowValue}>{formatCurrency(limit)}</Text>
        </View>
        {portfolio && (
          <Text style={styles.meta}>Split across its funds: {portfolio.allocations.map((a) => `${a.ticker} ${a.weightPct}%`).join(" · ")}</Text>
        )}
      </View>

      {!isBuy && held <= 0 ? (
        <Text style={styles.subtitle}>You don't hold this fund.</Text>
      ) : isBuy && !monthly && cash < 1 ? (
        <Text style={styles.subtitle}>You have no cash to invest right now. New cash arrives each month.</Text>
      ) : (
        <View style={styles.form}>
          {isBuy && (
            <View style={styles.segmentRow}>
              {[
                { label: "Buy once", value: false },
                { label: "Every month", value: true },
              ].map((o) => (
                <Pressable key={o.label} style={[styles.segment, monthly === o.value && styles.segmentSelected]} onPress={() => setMonthly(o.value)} disabled={submitting} accessibilityRole="button">
                  <Text style={[styles.segmentText, monthly === o.value && styles.segmentTextSelected]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={styles.label}>{monthly ? "Amount each month (dollars)" : "Amount (dollars)"}</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 100"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={(t) => {
              setAmount(t);
              setError(null);
            }}
            editable={!submitting}
            accessibilityLabel="Amount"
          />
          <View style={styles.chipRow}>
            {chips.map((c) => (
              <Pressable key={c.label} style={styles.chip} onPress={() => setAmount((Math.floor(c.value * 100) / 100).toFixed(2))} disabled={submitting}>
                <Text style={styles.chipText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.note}>
            {isBuy
              ? monthly
                ? `The first buy is made now if you have the cash, then again at the start of each month. If a month's cash does not cover it, that month is skipped. Priced at the close of ${longMonth(plan.latestDataMonth)}.`
                : `Priced at the close of ${longMonth(plan.latestDataMonth)}. It earns ${longMonth(plan.tradeMonth)}'s return once that month's data is in, and shows at cost until then.`
              : `Sold at the close of ${longMonth(plan.latestDataMonth)}; the money goes to your cash straight away.`}
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.submitButton, submitting && styles.disabled]} onPress={() => submit(false)} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>{!isBuy ? "Confirm sell" : monthly ? "Set up monthly buy" : "Confirm buy"}</Text>}
          </Pressable>
          {!isBuy && (
            <Pressable style={styles.secondaryButton} onPress={() => submit(true)} disabled={submitting}>
              <Text style={styles.secondaryButtonText}>Sell everything ({formatCurrency(held)})</Text>
            </Pressable>
          )}
        </View>
      )}
    </KeyboardScreen>
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
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#555", textAlign: "center", maxWidth: 320 },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowTop: { borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 8 },
  rowLabel: { flex: 1, color: "#555", fontSize: 14 },
  rowValue: { fontWeight: "700", fontSize: 14 },
  meta: { fontSize: 12, color: "#777" },
  form: { width: "100%", maxWidth: 360, gap: 8 },
  label: { fontSize: 14, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18 },
  segmentRow: { flexDirection: "row", borderWidth: 1, borderColor: "#2e6fdb", borderRadius: 8, overflow: "hidden" },
  segment: { flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: "#fff" },
  segmentSelected: { backgroundColor: "#2e6fdb" },
  segmentText: { color: "#2e6fdb", fontWeight: "600" },
  segmentTextSelected: { color: "#fff" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#2e6fdb", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#fff" },
  chipText: { color: "#2e6fdb", fontWeight: "600", fontSize: 13 },
  note: { fontSize: 12, color: "#777", maxWidth: 360, textAlign: "center" },
  error: { color: "#c0392b", textAlign: "center" },
  submitButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 14, alignItems: "center", width: "100%", maxWidth: 360, marginTop: 4 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.6 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
