/**
 * S-03 Portfolios — UC-03, reshaped by DECISIONS.md #19. User-facing tab label "Portfolios"
 * (the tab's route key stays "Contribution" so no navigation param has to be renamed).
 *
 * This used to be "Start plan": one portfolio, one monthly contribution, one start month.
 * There is no fixed plan any more. The tab lists ready-made portfolios (and the user's own
 * saved ones); each can be bought with any amount, split across its funds by weight. Single
 * funds are bought from the Funds tab. Buying is a one-off trade; monthly buys come later.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import type { MainTabScreenProps } from "../navigation/AppNavigator";
import { formatCurrency } from "../utils/peerFormat";

type Props = MainTabScreenProps<"Contribution">;

interface PortfolioSummary {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  allocations: { fundId: string; ticker: string; fundName: string; weightPct: number }[];
}

interface Summary {
  hasPlan: boolean;
  latestPlan: { walletBalance: number } | null;
}

const RISK_LABELS: Record<string, string> = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk" };

export function PortfoliosScreen({ navigation }: Props) {
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [cash, setCash] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([apiFetch<PortfolioSummary[]>("/portfolio/portfolios"), apiFetch<Summary>("/dashboard/summary").catch(() => null)])
      .then(([pfs, summary]) => {
        if (cancelled) return;
        setPortfolios(pfs);
        setCash(summary?.latestPlan?.walletBalance ?? null);
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

  if (loading && portfolios.length === 0) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error && portfolios.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Portfolios</Text>
      <Text style={styles.subtitle}>Buy a ready-made mix in one go. Your money is split across its funds by weight.</Text>

      {cash !== null && (
        <View style={styles.cashCard}>
          <Text style={styles.cashLabel}>Cash available</Text>
          <Text style={styles.cashValue}>{formatCurrency(cash)}</Text>
        </View>
      )}

      {portfolios.length === 0 && <Text style={styles.error}>No portfolios available yet.</Text>}

      {portfolios.map((p) => (
        <View key={p.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.cardName}>
              {p.name}
              {p.isPreset ? "" : " (yours)"}
            </Text>
            {p.riskLevel && <Text style={styles.risk}>{RISK_LABELS[p.riskLevel] ?? p.riskLevel}</Text>}
          </View>
          <Text style={styles.meta}>{p.allocations.map((a) => `${a.ticker} ${a.weightPct}%`).join(" · ")}</Text>
          <Pressable
            style={styles.buyButton}
            onPress={() => navigation.getParent()?.navigate("Trade", { mode: "buy", name: p.name, portfolioId: p.id })}
            accessibilityRole="button"
            accessibilityLabel={`Buy ${p.name}`}
          >
            <Text style={styles.buyButtonText}>Buy</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.getParent()?.navigate("Trade", { mode: "buy", name: p.name, portfolioId: p.id, monthly: true })}
            accessibilityRole="button"
            accessibilityLabel={`Buy ${p.name} every month`}
          >
            <Text style={styles.monthlyLink}>Or buy it every month</Text>
          </Pressable>
        </View>
      ))}

      <Pressable style={styles.secondaryButton} onPress={() => navigation.getParent()?.navigate("Recurring")}>
        <Text style={styles.secondaryButtonText}>Manage your monthly buys →</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Funds")}>
        <Text style={styles.secondaryButtonText}>Want a single fund, or your own mix? Open the Funds tab →</Text>
      </Pressable>
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
  cashCard: { width: "100%", maxWidth: 360, backgroundColor: "#1f3b73", borderRadius: 12, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cashLabel: { color: "#b8c7e6", fontSize: 13 },
  cashValue: { color: "#fff", fontSize: 20, fontWeight: "700" },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 14, gap: 8 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  cardName: { flex: 1, fontSize: 16, fontWeight: "600" },
  risk: { fontSize: 12, color: "#777" },
  meta: { fontSize: 12, color: "#777" },
  buyButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  monthlyLink: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", fontSize: 13 },
  buyButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600", textAlign: "center" },
});
