/**
 * S-05 Peer Comparison — UC-05. Percentile + peer medians, incl. fallback
 * tier used (transparency text per UC-05 step 6). Placeholder UI only;
 * wired to PeerGroupingService/PeerBenchmarkService (backend) in Phase 5.
 * NFR-03: only ever renders aggregated stats, never raw peer records.
 */
import { StyleSheet, Text, View } from "react-native";

export function PeerComparisonScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>S-05 · Peer Comparison</Text>
      <Text style={styles.body}>
        TODO Phase 5: GET /peers/summary, /peers/distribution; show tier-appropriate transparency caption
        (Design Model §5.2).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  body: { textAlign: "center", color: "#555" },
});
