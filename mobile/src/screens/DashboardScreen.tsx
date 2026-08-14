/**
 * S-04 Dashboard — UC-04, UC-07. Performance summary, growth chart, and
 * simulation history entry point. Placeholder UI only; wired to
 * DashboardService (backend) in Phase 4/7. NFR-01: target <2s load.
 */
import { StyleSheet, Text, View } from "react-native";

export function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>S-04 · Dashboard</Text>
      <Text style={styles.body}>
        TODO Phase 4/7: GET /dashboard/summary, /dashboard/growth, /dashboard/behaviour, /simulation/history.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  body: { textAlign: "center", color: "#555" },
});
