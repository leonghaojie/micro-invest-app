/**
 * S-06 Insights — UC-06. Rule-based insight cards from user-vs-peer gaps
 * (insight.service.ts), with a positive-reinforcement fallback when no
 * meaningful gap is detected. Each card that suggests an action gets an
 * "Adjust Plan" link back to S-03, per this screen's original TODO text.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Insights">;

type Tone = "positive" | "neutral" | "suggestion";

interface InsightCard {
  id: string;
  tone: Tone;
  title: string;
  body: string;
  showAdjustPlanAction: boolean;
}

const TONE_COLORS: Record<Tone, string> = {
  positive: "#2e8b57",
  suggestion: "#2e6fdb",
  neutral: "#777",
};

export function InsightsScreen({ navigation }: Props) {
  const [cards, setCards] = useState<InsightCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<InsightCard[]>("/insights")
      .then((res) => {
        if (!cancelled) setCards(res);
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

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Insights</Text>

      {cards.map((card) => (
        <View key={card.id} style={[styles.card, { borderLeftColor: TONE_COLORS[card.tone] }]}>
          <Text style={styles.cardTitle}>{card.title}</Text>
          <Text style={styles.cardBody}>{card.body}</Text>
          {card.showAdjustPlanAction && (
            <Pressable style={styles.adjustButton} onPress={() => navigation.navigate("SimulationSetup")}>
              <Text style={styles.adjustButtonText}>Adjust Plan</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
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
  error: { color: "#c0392b", textAlign: "center" },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardBody: { fontSize: 14, color: "#555", lineHeight: 20 },
  adjustButton: {
    alignSelf: "flex-start",
    backgroundColor: "#2e6fdb",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  adjustButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
