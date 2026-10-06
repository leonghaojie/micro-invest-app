/**
 * "What people like you hold" (DECISIONS.md #21): the asset-class mix of the peers behind the
 * diversification row against your own, the funds the most of them hold (with the ones you also
 * hold marked), and how many funds they hold. Aggregates only: a fund is listed only when at
 * least 3 peers hold it, and nothing here describes one person's portfolio.
 */
import { StyleSheet, Text, View } from "react-native";
import type { HoldingsSummary } from "../utils/cohortTypes";
import { MixBar, MixLegend } from "./charts/MixBar";

export function PeerHoldings({ holdings }: { holdings: HoldingsSummary }) {
  const classes = [...new Set([...holdings.peerMix, ...holdings.myMix].map((e) => e.assetClass))];
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>What people like you hold</Text>
      <Text style={styles.hint}>The {holdings.peerCount} investors you were compared with on diversification.</Text>

      <MixBar label="Peers (average)" entries={holdings.peerMix} />
      <MixBar label="You" entries={holdings.myMix} />
      <MixLegend classes={classes} />

      {holdings.topFunds.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.subHeading}>Most-held funds</Text>
          {holdings.topFunds.map((f) => (
            <View key={f.ticker} style={styles.row}>
              <View style={styles.name}>
                <Text style={styles.fund} numberOfLines={1}>
                  {f.ticker} · {f.name}
                </Text>
                {f.youHold && <Text style={styles.you}>You hold this</Text>}
              </View>
              <Text style={styles.pct}>{f.heldByPct}% of peers</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.hint}>No single fund is held by enough of them to list privately.</Text>
      )}

      <Text style={styles.hint}>
        They hold about {holdings.avgFunds.toFixed(1)} fund{holdings.avgFunds === 1 ? "" : "s"} on average; you hold {holdings.myFunds}. Only funds held by at
        least 3 peers are listed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 10 },
  heading: { fontSize: 16, fontWeight: "600" },
  subHeading: { fontSize: 13, fontWeight: "600", color: "#333" },
  hint: { fontSize: 12, color: "#777" },
  list: { gap: 8, marginTop: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  name: { flex: 1, gap: 1 },
  fund: { fontSize: 13, color: "#333" },
  you: { fontSize: 11, color: "#1a8f4c", fontWeight: "600" },
  pct: { fontSize: 13, fontWeight: "600", color: "#555" },
});
