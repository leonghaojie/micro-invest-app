/**
 * S-06 Insights — UC-06, rebuilt on the cohort engine (DECISIONS.md #32). Three cards
 * (portfolio value, savings rate, cash buffer) that say where the user stands among the
 * investors most like them, chosen the same way as the Peers tab. The cards describe a
 * position and never suggest an action, so there is no "Adjust Plan" button any more.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import type { MainTabScreenProps } from "../navigation/AppNavigator";
import { formatCurrency } from "../utils/peerFormat";

type Props = MainTabScreenProps<"Insights">;

type Unit = "currency" | "%" | "months";

interface InsightCard {
  key: "value" | "savingsRate" | "cashBuffer";
  title: string;
  status: "ok" | "unavailable" | "withheld";
  body: string;
  unit: Unit;
  you?: number;
  median?: number;
  p25?: number;
  p75?: number;
  percentile?: number;
  cohortSize?: number;
  basis: string;
}

type InsightsResponse =
  | { status: "no-profile" | "no-plan" | "no-data" }
  | { status: "ok"; asOf: string; simulatedPct: number; cards: InsightCard[] };

const FORMAT: Record<Unit, (v: number) => string> = {
  currency: formatCurrency,
  "%": (v) => `${Math.round(v)}%`,
  months: (v) => `${v.toFixed(1)} mo`,
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export function InsightsScreen({ navigation }: Props) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<InsightsResponse>("/insights")
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
        <Text style={styles.error}>{error ?? "Couldn't load your insights. Please try again."}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (data.status === "no-profile" || data.status === "no-plan") {
    const needsProfile = data.status === "no-profile";
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.message}>
          {needsProfile
            ? "Set up your profile so we can find investors like you."
            : "Make your first investment to see how you compare with investors like you."}
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => (needsProfile ? navigation.navigate("ProfileSetup") : navigation.navigate("Invest", { tab: "managed" }))}
        >
          <Text style={styles.primaryButtonText}>{needsProfile ? "Set up profile" : "Browse portfolios"}</Text>
        </Pressable>
      </View>
    );
  }

  if (data.status !== "ok") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.message}>Fund data isn't available yet. Please try again later.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Insights</Text>
      <Text style={styles.subtitle}>Where you stand among investors like you, as of the end of {monthLabel(data.asOf)}.</Text>

      {data.cards.map((card) => (
        <View key={card.key} style={styles.card}>
          <Text style={styles.cardTitle}>{card.title}</Text>
          <Text style={styles.cardBody}>{card.body}</Text>
          {card.status === "ok" && <RangeBar card={card} />}
        </View>
      ))}

      <Text style={styles.footnote}>
        Each card compares you with the investors closest to you in the things named on it, never with any one person. About{" "}
        {data.simulatedPct}% of the investors compared are simulated. These figures describe where you stand; they are not advice.
      </Text>
    </ScrollView>
  );
}

/** The peers' middle half as a band, the median as a tick and the user as a dot, on one shared scale. */
function RangeBar({ card }: { card: InsightCard }) {
  const you = card.you as number;
  const p25 = card.p25 as number;
  const p75 = card.p75 as number;
  const median = card.median as number;
  const lo = Math.min(you, p25);
  const hi = Math.max(you, p75);
  const pad = (hi - lo) * 0.1 || 1;
  const at = (v: number) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%` as const;
  const fmt = FORMAT[card.unit];

  return (
    <View style={styles.rangeWrap}>
      <View style={styles.track}>
        <View style={[styles.band, { left: at(p25), width: `${((p75 - p25) / (hi - lo + 2 * pad)) * 100}%` }]} />
        <View style={[styles.medianTick, { left: at(median) }]} />
        <View style={[styles.youDot, { left: at(you) }]} />
      </View>
      <View style={styles.legendRow}>
        <Text style={styles.legend}>
          <Text style={styles.legendYou}>● You {fmt(you)}</Text>
          {"   "}
          <Text style={styles.legendMedian}>┃</Text> Median {fmt(median)}
          {"   "}
          <Text style={styles.legendBand}>■</Text> Middle half
        </Text>
      </View>
      <Text style={styles.basis}>
        {card.cohortSize} investors with {card.basis}
      </Text>
    </View>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load your insights. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#666", textAlign: "center", maxWidth: 360 },
  message: { fontSize: 14, color: "#555", textAlign: "center", maxWidth: 320, lineHeight: 20 },
  error: { color: "#c0392b", textAlign: "center" },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderLeftWidth: 4,
    borderLeftColor: "#2e6fdb",
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardBody: { fontSize: 14, color: "#555", lineHeight: 20 },
  rangeWrap: { gap: 6, marginTop: 4 },
  track: { height: 14, borderRadius: 7, backgroundColor: "#eef1f5", position: "relative", overflow: "visible" },
  band: { position: "absolute", top: 0, bottom: 0, backgroundColor: "#c9d8f4", borderRadius: 7 },
  medianTick: { position: "absolute", top: -2, bottom: -2, width: 2, marginLeft: -1, backgroundColor: "#555" },
  youDot: { position: "absolute", top: 1, width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: "#2e6fdb", borderWidth: 2, borderColor: "#fff" },
  legendRow: { flexDirection: "row" },
  legend: { fontSize: 12, color: "#555" },
  legendYou: { color: "#2e6fdb", fontWeight: "600" },
  legendMedian: { color: "#555", fontWeight: "700" },
  legendBand: { color: "#c9d8f4" },
  basis: { fontSize: 12, color: "#888" },
  footnote: { fontSize: 12, color: "#888", maxWidth: 360, lineHeight: 17, marginTop: 4 },
  primaryButton: { backgroundColor: "#2e6fdb", borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16 },
  primaryButtonText: { color: "#fff", fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
