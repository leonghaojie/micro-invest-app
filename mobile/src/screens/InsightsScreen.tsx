/**
 * S-06 Insights — UC-06. Actionable suggestions from user-vs-peer gaps.
 * Placeholder UI only; wired to InsightService (backend) in Phase 6.
 */
import { StyleSheet, Text, View } from "react-native";

export function InsightsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>S-06 · Insights</Text>
      <Text style={styles.body}>TODO Phase 6: GET /insights; render 1–3 insight cards, "Adjust Plan" link back to S-03.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  body: { textAlign: "center", color: "#555" },
});
