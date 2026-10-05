/**
 * Peers view of the Peer Comparison tab — DECISIONS.md #9 (3 Oct 2026).
 * Replaces the three fixed quartile bars with a segment-aware dashboard:
 *  - choose what "peers" means (income, age, risk level, goal, start month);
 *  - where you stand: exact percentile plus a histogram of the group;
 *  - a month-by-month trajectory against the peer median and middle-50% band;
 *  - what peers hold (asset-class mix, most-held funds).
 *
 * All of it is aggregate-only (GET /peers/dashboard, NFR-03). A selection
 * matching fewer than 10 peers returns no statistics at all — the server
 * never reveals a small exact count — and this screen just says so.
 */
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { BandChart, TrajectoryPoint } from "../components/charts/BandChart";
import { Histogram, HistogramBin } from "../components/charts/Histogram";
import { ASSET_CLASS_LABELS, MixBar, MixEntry, MixLegend } from "../components/charts/MixBar";
import { METRICS, metricMeta, ordinal, PeerMetric } from "../utils/peerFormat";

type Dimension = "income" | "age" | "risk" | "goal" | "startMonth";

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "income", label: "Income" },
  { key: "age", label: "Age ±5 yrs" },
  { key: "risk", label: "Risk level" },
  { key: "goal", label: "Goal" },
  { key: "startMonth", label: "Same start month" },
];

interface PeerDashboardResponse {
  group: {
    dims: Dimension[];
    bandPct: number | null;
    ageRange: { lo: number; hi: number } | null;
    memberCount: number | null;
    suppressed: boolean;
    message: string;
  };
  metric: PeerMetric;
  me: { value: number | null; percentileRank: number | null };
  distribution: {
    bins: HistogramBin[];
    p25: number;
    p50: number;
    p75: number;
    lo: number;
    hi: number;
    peerCount: number;
  } | null;
  trajectory: TrajectoryPoint[] | null;
  allocation: {
    peerMix: MixEntry[];
    topFunds: { ticker: string; name: string; heldByPct: number }[];
    avgHoldings: number;
    myMix: MixEntry[];
  } | null;
}

export function PeerDashboard({ onStartPlan }: { onStartPlan: () => void }) {
  const [dims, setDims] = useState<Dimension[]>(["income"]);
  const [metric, setMetric] = useState<PeerMetric>("value");
  const [data, setData] = useState<PeerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Out-of-order protection: only the latest request may update the screen.
  const requestId = useRef(0);
  const hasData = useRef(false);

  const dimsKey = dims.join(",");

  const load = useCallback(() => {
    const id = ++requestId.current;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    setError(null);

    apiFetch<PeerDashboardResponse>(`/peers/dashboard?dims=${dimsKey}&metric=${metric}`)
      .then((res) => {
        if (id !== requestId.current) return;
        hasData.current = true;
        setData(res);
      })
      .catch((err) => {
        if (id === requestId.current) setError(describeError(err));
      })
      .finally(() => {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      });
  }, [dimsKey, metric]);

  useFocusEffect(load);

  function toggleDim(key: Dimension) {
    setDims((prev) => {
      const next = prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key];
      return DIMENSIONS.map((d) => d.key).filter((k) => next.includes(k)); // keep a stable order
    });
  }

  if (loading && !data) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  const meta = metricMeta(metric);
  const { group, me, distribution, trajectory, allocation } = data;

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Peer Comparison</Text>
      <Text style={styles.subtitle}>Choose who counts as a peer, then see where you stand.</Text>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Peers who match you on</Text>
        <View style={styles.chipWrap}>
          {DIMENSIONS.map((d) => (
            <Chip key={d.key} label={d.label} selected={dims.includes(d.key)} onPress={() => toggleDim(d.key)} />
          ))}
        </View>
        <Text style={styles.hint}>
          {group.message}
          {!group.suppressed && group.memberCount !== null ? ` (${group.memberCount} peers)` : ""}
        </Text>
        {refreshing && <Text style={styles.hint}>Updating…</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.chipWrap}>
        {METRICS.map((m) => (
          <Chip key={m.key} label={m.label} selected={metric === m.key} onPress={() => setMetric(m.key)} />
        ))}
      </View>

      {group.suppressed && (
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.cardHeading}>Not enough peers to show</Text>
          <Text style={styles.body}>
            To protect privacy, statistics are only shown for groups of at least 10 people. Turn off one of the filters above to
            widen the group.
          </Text>
          {me.value !== null && (
            <Text style={styles.body}>
              Your {meta.label.toLowerCase()}: <Text style={styles.strong}>{meta.format(me.value)}</Text>
            </Text>
          )}
        </View>
      )}

      {!group.suppressed && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardHeading}>Where you stand</Text>
            {me.value === null ? (
              <>
                <Text style={styles.body}>Make your first investment to see how you compare.</Text>
                <Pressable style={styles.submitButton} onPress={onStartPlan}>
                  <Text style={styles.submitButtonText}>Browse portfolios</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.bigStat}>{describeRank(me.percentileRank, group.memberCount)}</Text>
                <Text style={styles.body}>
                  Your {meta.label.toLowerCase()}: <Text style={styles.strong}>{meta.format(me.value)}</Text>
                  {distribution ? `  ·  Peer median: ${meta.format(distribution.p50)}` : ""}
                </Text>
                {metric === "value" && (
                  <Text style={styles.hint}>
                    Plans started in different months, so a younger plan can sit low simply because it's younger. See the
                    month-by-month chart below, or match on "Same start month".
                  </Text>
                )}
              </>
            )}
          </View>

          {distribution ? (
            <View style={styles.card}>
              <Text style={styles.cardHeading}>{meta.label} across {distribution.peerCount} peers</Text>
              <Histogram
                bins={distribution.bins}
                p25={distribution.p25}
                p50={distribution.p50}
                p75={distribution.p75}
                mine={me.value}
                axisFormat={meta.axis}
              />
              <Text style={styles.hint}>
                Dashed lines mark the 25th and 75th percentiles. Extreme values are grouped at the ends, and tiny groups are merged
                so no bar describes just one or two people.
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.body}>Not enough peers have a {meta.label.toLowerCase()} yet to show a distribution.</Text>
            </View>
          )}

          {trajectory && (
            <View style={styles.card}>
              <Text style={styles.cardHeading}>Month by month</Text>
              <BandChart points={trajectory} axisFormat={meta.axis} />
              <View style={styles.legendRow}>
                <LegendSwatch color="#cddcf7" label="Middle 50% of peers" box />
                <LegendSwatch color="#555" label="Peer median" />
                <LegendSwatch color="#2e6fdb" label="You" />
              </View>
              <Text style={styles.hint}>
                Aligned by months since each plan started (M1 = first month), so plans of different ages are compared like for like.
                A month appears only while at least 10 peers have reached it.
              </Text>
            </View>
          )}

          {allocation && <AllocationCard allocation={allocation} />}
        </>
      )}

      <Text style={styles.footnote}>
        Peer data is simulated — about 300 synthetic peers, with income calibrated to published Singapore statistics (median ≈ S$3,615 a
        month per household member, SingStat 2024). Expense and contribution patterns are assumptions.
      </Text>
    </ScrollView>
  );
}

function AllocationCard({ allocation }: { allocation: NonNullable<PeerDashboardResponse["allocation"]> }) {
  const classes = [...new Set([...allocation.peerMix, ...allocation.myMix].map((e) => e.assetClass))];
  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>What peers hold</Text>
      <MixBar label="Peers (average)" entries={allocation.peerMix} />
      <MixBar label="You" entries={allocation.myMix} />
      <MixLegend classes={classes} />

      {allocation.topFunds.length > 0 && (
        <View style={styles.fundList}>
          <Text style={styles.subHeading}>Most-held funds</Text>
          {allocation.topFunds.map((f) => (
            <View key={f.ticker} style={styles.fundRow}>
              <Text style={styles.fundName} numberOfLines={1}>
                {f.ticker} · {f.name}
              </Text>
              <Text style={styles.fundPct}>{f.heldByPct}%</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.hint}>
        Peers hold about {allocation.avgHoldings.toFixed(1)} funds on average. Asset classes:{" "}
        {allocation.peerMix.map((e) => `${ASSET_CLASS_LABELS[e.assetClass] ?? e.assetClass} ${Math.round(e.pct)}%`).join(", ")}.
      </Text>
    </View>
  );
}

function describeRank(rank: number | null, memberCount: number | null): string {
  if (rank === null) return "Not enough data to rank you yet";
  const of = memberCount !== null ? ` of ${memberCount} peers` : "";
  if (rank <= 0) return `Below all${memberCount !== null ? ` ${memberCount}` : ""} peers`;
  if (rank >= 100) return `Above all${memberCount !== null ? ` ${memberCount}` : ""} peers`;
  return `${ordinal(rank)} percentile${of}`;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function LegendSwatch({ color, label, box }: { color: string; label: string; box?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[box ? styles.swatchBox : styles.swatchLine, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load your peer comparison. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 4, textAlign: "center", maxWidth: 360 },
  body: { fontSize: 14, color: "#555" },
  strong: { fontWeight: "700", color: "#333" },
  bigStat: { fontSize: 26, fontWeight: "700", color: "#2e6fdb" },
  hint: { fontSize: 12, color: "#777" },
  footnote: { fontSize: 11, color: "#999", textAlign: "center", maxWidth: 360, marginTop: 4 },
  error: { color: "#c0392b", textAlign: "center" },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 16,
    gap: 10,
  },
  warnCard: { borderColor: "#e0b34d", backgroundColor: "#fff8e6" },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  subHeading: { fontSize: 13, fontWeight: "600", color: "#333" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 360 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#fff" },
  chipSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#2e6fdb", fontWeight: "600" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 11, color: "#555" },
  swatchBox: { width: 14, height: 10, borderRadius: 2 },
  swatchLine: { width: 14, height: 3, borderRadius: 2 },
  fundList: { gap: 6, marginTop: 4 },
  fundRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  fundName: { flex: 1, fontSize: 13, color: "#333" },
  fundPct: { fontSize: 13, fontWeight: "600", color: "#555" },
  submitButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
