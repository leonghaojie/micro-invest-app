/**
 * Discover — the "Discover" view of the Invest tab (DECISIONS.md #30; it was the Funds tab, #14, #16).
 * Browse the whole fund catalog: ticker, asset class, exchange, the latest monthly return and how much real
 * history there is, searchable and filterable by asset class. Tap a fund to see how it has moved (and to
 * buy or sell it). Building your own mix from these funds is the Custom view.
 *
 * All prices and returns are in Singapore dollars; a fund listed in US dollars is converted (#29).
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ASSET_CLASS_LABELS } from "../components/charts/MixBar";
import { FundFilters } from "../components/FundFilters";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useFundCatalog, useFundFilter } from "../utils/fundCatalog";
import type { InvestTab } from "../utils/investTabs";

export function DiscoverFunds({ onSelectTab }: { onSelectTab: (tab: InvestTab) => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { funds, loading, error, reload, dataThrough } = useFundCatalog();
  const filter = useFundFilter(funds);

  if (loading && funds.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error && funds.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.secondaryButton} onPress={reload}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Discover funds</Text>
      <Text style={styles.subtitle}>
        Tap a fund to see how it has moved. All prices and returns are in Singapore dollars; funds listed in US dollars are converted.
      </Text>
      {dataThrough && <Text style={styles.dataNote}>Fund data through {dataThrough} · updates automatically each month</Text>}

      <View style={styles.column}>
        <FundFilters filter={filter} total={funds.length} />

        {filter.visible.map((fund) => (
          <Pressable
            key={fund.id}
            style={styles.card}
            onPress={() => navigation.navigate("FundDetail", { fundId: fund.id, ticker: fund.ticker })}
            accessibilityRole="button"
            accessibilityLabel={`${fund.ticker} details`}
          >
            <Text style={styles.name}>
              {fund.ticker} — {fund.name}
            </Text>
            <Text style={styles.meta}>
              {ASSET_CLASS_LABELS[fund.assetClass] ?? fund.assetClass} · {fund.exchange} · {fund.currency} ·{" "}
              {fund.latestMonthlyReturn !== null ? `${(fund.latestMonthlyReturn * 100).toFixed(1)}% last month` : "no data yet"} · real data since{" "}
              {fund.earliestMonth ?? "—"} ({fund.monthsAvailable}mo)
            </Text>
            <Text style={styles.link}>View history ›</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.secondaryButton} onPress={() => onSelectTab("custom")}>
        <Text style={styles.secondaryButtonText}>Want to combine funds into your own mix? Open Custom →</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  container: { alignItems: "center", padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", textAlign: "center", maxWidth: 340 },
  dataNote: { fontSize: 12, color: "#888", marginBottom: 8, textAlign: "center" },
  column: { width: "100%", maxWidth: 360, gap: 8 },
  error: { color: "#c0392b", textAlign: "center" },
  card: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  name: { color: "#333" },
  meta: { fontSize: 12, color: "#777" },
  link: { color: "#2e6fdb", fontSize: 12, fontWeight: "600", marginTop: 2 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600", textAlign: "center" },
});
