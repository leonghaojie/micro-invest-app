/**
 * S-02 Profile Setup — UC-02. Collect risk level, goal type, budget band.
 * Placeholder UI only; wired to ProfileService (backend) in Phase 3.
 */
import { StyleSheet, Text, View } from "react-native";

export function ProfileSetupScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>S-02 · Profile Setup</Text>
      <Text style={styles.body}>TODO Phase 3: risk level, goal type, monthly budget inputs; POST /user/profile.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  body: { textAlign: "center", color: "#555" },
});
