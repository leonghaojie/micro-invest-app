/**
 * S-03 Simulation Setup — UC-03. Select portfolio template + plan
 * parameters. Placeholder UI only; wired in Phase 3 (templates) / Phase 4
 * (run simulation).
 */
import { StyleSheet, Text, View } from "react-native";

export function SimulationSetupScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>S-03 · Simulation Setup</Text>
      <Text style={styles.body}>
        TODO Phase 3/4: GET /portfolio/templates, then amount/frequency/duration form, POST /simulation/run.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  body: { textAlign: "center", color: "#555" },
});
