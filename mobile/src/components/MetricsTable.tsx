/**
 * The peer comparison as one table (DECISIONS.md #20): a row per measure with your figure, the
 * peers' median and your position, instead of a card per measure. Tap a row to open a plain-
 * language explanation underneath it: what the measure is, how it is worked out, what the
 * numbers mean for you, and who you were compared with. One row is open at a time.
 *
 * A measure that cannot be shown (not enough history, or too few peers to show privately) still
 * has its row, with dashes, and opening it says why.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Card } from "../utils/cohortTypes";
import { describeResult, formatMetric, METRIC_INFO, positionText } from "../utils/metricInfo";

export function MetricsTable({ cards }: { cards: Card[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.metricCell, styles.headerText]}>Metric</Text>
        <Text style={[styles.numCell, styles.headerText]}>You</Text>
        <Text style={[styles.numCell, styles.headerText]}>Peer median</Text>
        <Text style={[styles.posCell, styles.headerText]}>Position</Text>
      </View>

      {cards.map((card) => {
        const ok = card.status === "ok";
        const isOpen = open === card.key;
        return (
          <View key={card.key} style={styles.group}>
            <Pressable
              style={[styles.row, isOpen && styles.rowOpen]}
              onPress={() => setOpen(isOpen ? null : card.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${card.label}: tap to ${isOpen ? "hide" : "see"} what it means`}
            >
              <View style={styles.metricCell}>
                <Text style={styles.metricName}>{card.label}</Text>
                <Text style={styles.more}>{isOpen ? "Hide" : "What's this?"} {isOpen ? "▴" : "›"}</Text>
              </View>
              <Text style={[styles.numCell, styles.you]}>{ok ? formatMetric(card, card.you!) : "—"}</Text>
              <Text style={styles.numCell}>{ok ? formatMetric(card, card.median!) : "—"}</Text>
              <Text style={styles.posCell}>{ok ? positionText(card.percentile!, card.topPct!) : "—"}</Text>
            </Pressable>

            {isOpen && <Explanation card={card} />}
          </View>
        );
      })}
    </View>
  );
}

function Explanation({ card }: { card: Card }) {
  const info = METRIC_INFO[card.key];
  const result = describeResult(card);
  return (
    <View style={styles.panel}>
      <Section title="What it is" body={info.what} />
      <Section title="How it is worked out" body={info.how} />
      <Section title="What the numbers mean" body={info.meaning} />

      {card.status === "ok" && <RangeBar card={card} />}

      {card.status !== "ok" ? (
        <Section
          title="Why there is no figure"
          body={card.message ?? (card.status === "withheld" ? "Too few comparable investors to show this privately." : "Not available yet.")}
        />
      ) : (
        <>
          {result && <Section title="Your result" body={result} />}
          {card.detail && (
            <Text style={styles.detail}>
              {card.detail.label}: <Text style={styles.strong}>{card.detail.you.toFixed(0)}%</Text> for you, {card.detail.median.toFixed(0)}% for the median investor.
            </Text>
          )}
          {card.note && <Text style={styles.note}>{card.note}</Text>}
          <Section
            title="Who you were compared with"
            body={`${card.cohortSize} investors ${card.filter ? `at the ${card.filter}, with ` : "with "}${card.basis}.${
              card.relaxations.length > 0 ? ` Too few matched exactly, so we ${card.relaxations.join("; ")}.` : ""
            }`}
          />
        </>
      )}
    </View>
  );
}

/**
 * Where your figure sits among the peers: a bar for the middle half of them (25th to 75th
 * percentile), a tick at the median and a dot for you. The scale runs just past whichever
 * of those is furthest out, so you can always be seen.
 */
function RangeBar({ card }: { card: Card }) {
  const { p25, p75, median, you } = card;
  if (p25 === undefined || p75 === undefined || median === undefined || you === undefined) return null;
  const lo = Math.min(p25, you, median);
  const hi = Math.max(p75, you, median);
  const pad = (hi - lo || Math.max(Math.abs(hi), 1)) * 0.15;
  const min = lo - pad;
  const span = hi + pad - min;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / span) * 100))}%` as const;
  return (
    <View style={styles.rangeWrap}>
      <View style={styles.track}>
        <View style={[styles.band, { left: at(p25), width: `${Math.max(((p75 - p25) / span) * 100, 1.5)}%` }]} />
        <View style={[styles.medianTick, { left: at(median) }]} />
        <View style={[styles.youDot, { left: at(you) }]} accessibilityLabel="Your figure" />
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          <Text style={styles.legendBand}>▬</Text> Middle half of peers: {formatMetric(card, p25)} to {formatMetric(card, p75)}
        </Text>
        <Text style={styles.legendText}>
          <Text style={styles.legendMedian}>┃</Text> Median {formatMetric(card, median)}   <Text style={styles.legendYou}>●</Text> You {formatMetric(card, you)}
        </Text>
      </View>
    </View>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, overflow: "hidden", backgroundColor: "#fff" },
  group: { borderTopWidth: 1, borderTopColor: "#eee" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12, gap: 6 },
  rowOpen: { backgroundColor: "#f4f8ff" },
  headerRow: { backgroundColor: "#f7f7f9", paddingVertical: 8 },
  headerText: { fontSize: 11, fontWeight: "700", color: "#666" },
  metricCell: { flex: 1.5 },
  numCell: { flex: 0.95, textAlign: "right", fontSize: 13, color: "#333" },
  posCell: { flex: 1, textAlign: "right", fontSize: 13, fontWeight: "600", color: "#333" },
  metricName: { fontSize: 13, fontWeight: "600", color: "#333" },
  more: { fontSize: 11, color: "#2e6fdb", marginTop: 2 },
  you: { fontWeight: "700", color: "#2e6fdb" },
  panel: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 4, gap: 10, backgroundColor: "#f4f8ff" },
  section: { gap: 2 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#333" },
  sectionBody: { fontSize: 13, color: "#555", lineHeight: 18 },
  detail: { fontSize: 13, color: "#555" },
  strong: { fontWeight: "700", color: "#333" },
  note: { fontSize: 12, color: "#b9770e" },
  rangeWrap: { gap: 6 },
  track: { height: 14, borderRadius: 7, backgroundColor: "#e9eef7", justifyContent: "center" },
  band: { position: "absolute", top: 3, height: 8, borderRadius: 4, backgroundColor: "#b9cdf0" },
  medianTick: { position: "absolute", top: 1, width: 2, height: 12, marginLeft: -1, backgroundColor: "#555" },
  youDot: { position: "absolute", top: 0, width: 14, height: 14, marginLeft: -7, borderRadius: 7, backgroundColor: "#2e6fdb", borderWidth: 2, borderColor: "#fff" },
  legend: { gap: 2 },
  legendText: { fontSize: 11, color: "#666" },
  legendBand: { color: "#9db8e8" },
  legendMedian: { color: "#555" },
  legendYou: { color: "#2e6fdb" },
});
