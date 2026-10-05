/**
 * Stacked horizontal bar of an asset-class mix (DECISIONS.md #9) — used for
 * the peers' average allocation and the user's own, side by side. Plain
 * Views, no SVG needed.
 */
import { StyleSheet, Text, View } from "react-native";

export interface MixEntry {
  assetClass: string;
  pct: number;
}

export const ASSET_CLASS_LABELS: Record<string, string> = {
  EQUITY: "Equity",
  EQUITY_EM: "EM equity",
  BOND: "Bonds",
  REIT: "REITs",
  COMMODITY: "Commodities",
};

export const ASSET_CLASS_COLORS: Record<string, string> = {
  EQUITY: "#2e6fdb",
  EQUITY_EM: "#7b5fd6",
  BOND: "#2e8b57",
  REIT: "#e08a2c",
  COMMODITY: "#c9a227",
};

export function MixBar({ label, entries }: { label?: string; entries: MixEntry[] }) {
  return (
    <View style={styles.block}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {entries.length === 0 ? (
        <Text style={styles.empty}>Nothing held yet</Text>
      ) : (
        <View style={styles.bar}>
          {entries.map((e) => (
            <View
              key={e.assetClass}
              style={{ flex: Math.max(e.pct, 0.5), backgroundColor: ASSET_CLASS_COLORS[e.assetClass] ?? "#999" }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export function MixLegend({ classes }: { classes: string[] }) {
  return (
    <View style={styles.legend}>
      {classes.map((c) => (
        <View key={c} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: ASSET_CLASS_COLORS[c] ?? "#999" }]} />
          <Text style={styles.legendText}>{ASSET_CLASS_LABELS[c] ?? c}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 4 },
  label: { fontSize: 12, color: "#555", fontWeight: "600" },
  empty: { fontSize: 12, color: "#999" },
  bar: { flexDirection: "row", height: 16, borderRadius: 4, overflow: "hidden", backgroundColor: "#eee" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: "#555" },
});
