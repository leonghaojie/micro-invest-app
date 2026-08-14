/**
 * S-01 Welcome / Login — UC-01. Authenticate user and enter system.
 * Placeholder UI only; wired to AuthService (backend) in Phase 3.
 */
import { StyleSheet, Text, View } from "react-native";

export function WelcomeLoginScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>S-01 · Welcome / Login</Text>
      <Text style={styles.body}>TODO Phase 3: email/password form, calls /auth/login and /auth/register.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  body: { textAlign: "center", color: "#555" },
});
