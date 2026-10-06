/**
 * Managed portfolios — the "Managed" view of the Invest tab (S-03, UC-03; DECISIONS.md #19, #28, #30). It was
 * the Portfolios tab.
 *
 * Lists the ready-made portfolios in three groups, Low, Medium and High risk. Each is a card with its tagline,
 * what it holds and how it has done in the past; tapping one opens its page (PortfolioDetailScreen: key
 * details, composition, past returns) where it can be bought, once or every month, with any amount split
 * across its funds by weight. Single funds are browsed in Discover, and the user's own mixes are built and
 * kept in Custom.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import { MixBar } from "../components/charts/MixBar";
import type { RootStackParamList } from "../navigation/AppNavigator";
import type { InvestTab } from "../utils/investTabs";

interface PortfolioSummary {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  tagline: string | null;
  history: { annualizedReturnPct: number | null; maxDrawdownPct: number; months: number } | null;
  allocations: { fundId: string; ticker: string; fundName: string; assetClass: string; weightPct: number }[];
}

const GROUPS: { risk: string; title: string; blurb: string; color: string }[] = [
  { risk: "LOW", title: "Low risk", blurb: "Smaller ups and downs. Mostly bonds and cash-like funds.", color: "#2e8b57" },
  { risk: "MEDIUM", title: "Medium risk", blurb: "A balance of growth and steadiness: stocks with bonds, REITs or gold.", color: "#e08a2c" },
  { risk: "HIGH", title: "High risk", blurb: "The most room to grow and the biggest falls. Mostly stocks.", color: "#c0392b" },
];

export function ManagedPortfolios({ onSelectTab }: { onSelectTab: (tab: InvestTab) => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<PortfolioSummary[]>("/portfolio/portfolios")
      .then((pfs) => {
        if (!cancelled) setPortfolios(pfs);
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

  function open(p: PortfolioSummary) {
    navigation.navigate("PortfolioDetail", { portfolioId: p.id, name: p.name });
  }

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

  const presets = portfolios.filter((p) => p.isPreset);

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Managed portfolios</Text>
      <Text style={styles.subtitle}>Pick a ready-made mix, learn what is in it, then buy it in one go. Your money is split across its funds by weight.</Text>

      {portfolios.length === 0 && <Text style={styles.error}>No portfolios available yet.</Text>}

      {GROUPS.map((g) => {
        const inGroup = presets.filter((p) => p.riskLevel === g.risk);
        if (inGroup.length === 0) return null;
        return (
          <View key={g.risk} style={styles.group}>
            <View style={styles.groupHead}>
              <View style={[styles.dot, { backgroundColor: g.color }]} />
              <Text style={styles.groupTitle}>{g.title}</Text>
            </View>
            <Text style={styles.groupBlurb}>{g.blurb}</Text>
            {inGroup.map((p) => (
              <PortfolioCard key={p.id} p={p} onOpen={() => open(p)} />
            ))}
          </View>
        );
      })}

      <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Recurring")}>
        <Text style={styles.secondaryButtonText}>Manage your monthly buys →</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => onSelectTab("discover")}>
        <Text style={styles.secondaryButtonText}>Want a single fund? Open Discover →</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => onSelectTab("custom")}>
        <Text style={styles.secondaryButtonText}>Want your own mix? Open Custom →</Text>
      </Pressable>
      <Text style={styles.disclaimer}>Past performance doesn't predict future results. This is information, not advice.</Text>
    </ScrollView>
  );
}

function PortfolioCard({ p, onOpen }: { p: PortfolioSummary; onOpen: () => void }) {
  // Weight per asset class, for the bar.
  const byClass = new Map<string, number>();
  for (const a of p.allocations) byClass.set(a.assetClass, (byClass.get(a.assetClass) ?? 0) + a.weightPct);
  const mix = [...byClass.entries()].map(([assetClass, pct]) => ({ assetClass, pct })).sort((a, b) => b.pct - a.pct);
  const h = p.history;

  return (
    <Pressable style={styles.card} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${p.name}: see details`}>
      <View style={styles.cardTop}>
        <Text style={styles.cardName}>{p.isPreset ? p.name : `${p.name} (yours)`}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
      {p.tagline && <Text style={styles.tagline}>{p.tagline}</Text>}
      <MixBar entries={mix} />
      <Text style={styles.meta}>{p.allocations.map((a) => `${a.ticker} ${a.weightPct}%`).join(" · ")}</Text>
      <Text style={styles.past}>
        {h === null
          ? "Not enough history yet"
          : `Past: ${h.annualizedReturnPct === null ? "—" : `${h.annualizedReturnPct > 0 ? "+" : ""}${h.annualizedReturnPct.toFixed(1)}% a year`} · worst fall ${h.maxDrawdownPct.toFixed(0)}%`}
      </Text>
    </Pressable>
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
  group: { width: "100%", maxWidth: 360, gap: 10, marginTop: 6 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  groupTitle: { fontSize: 18, fontWeight: "700" },
  groupBlurb: { fontSize: 12, color: "#777", marginBottom: 2 },
  card: { width: "100%", borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 14, gap: 8 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardName: { flex: 1, fontSize: 16, fontWeight: "600" },
  chevron: { fontSize: 22, color: "#999" },
  tagline: { fontSize: 13, color: "#444" },
  meta: { fontSize: 12, color: "#777" },
  past: { fontSize: 12, color: "#555", fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600", textAlign: "center" },
  disclaimer: { fontSize: 11, color: "#888", textAlign: "center", maxWidth: 340 },
});
