/**
 * Cohort view of the Peer Comparison tab — the default (DECISIONS.md #18, 5 Oct 2026).
 * Answers "compared with whom?" before it shows any number: the headline sets your
 * return against similar investors' median and a plain market benchmark, a label names
 * the cohort you were placed in, "Your peer group" describes the people behind it, and
 * four cards compare you with them, each saying why those peers were chosen.
 *
 * Aggregate-only (GET /peers/cohort, NFR-03). The server returns every figure and every
 * sentence of explanation; this screen only lays them out.
 */
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";

type Risk = "LOW" | "MEDIUM" | "HIGH";

interface Card {
  key: "investmentRate" | "diversification" | "return" | "returnPerRisk";
  label: string;
  unit: "%" | "score" | "ratio";
  status: "ok" | "unavailable" | "withheld";
  message?: string;
  you?: number;
  median?: number;
  p25?: number;
  p75?: number;
  percentile?: number;
  topPct?: number;
  cohortSize?: number;
  basis: string;
  filter: string | null;
  relaxations: string[];
  detail?: { label: string; you: number; median: number; unit: "%" };
}

interface CohortReport {
  suppressed: boolean;
  identity: string[];
  group: {
    size: number;
    ageRange: [number, number];
    contributionRange: [number, number];
    risk: Record<Risk, number>;
  } | null;
  headline: {
    windowMonths: number;
    you: number;
    peerMedian: number | null;
    peerCount: number;
    benchmark: { label: string; returnPct: number } | null;
  } | null;
  cards: Card[];
  observation: string | null;
}

type CohortResponse =
  | { status: "no-profile" | "no-plan" | "no-data" }
  | { status: "ok"; asOf: string; population: { size: number; simulatedPct: number }; report: CohortReport };

const RISK_NAMES: Record<Risk, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export function PeerCohort({ onStartPlan, onEditProfile }: { onStartPlan: () => void; onEditProfile: () => void }) {
  const [data, setData] = useState<CohortResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasData = useRef(false);

  const load = useCallback(() => {
    if (!hasData.current) setLoading(true);
    setError(null);
    apiFetch<CohortResponse>("/peers/cohort")
      .then((res) => {
        hasData.current = true;
        setData(res);
      })
      .catch((err) => setError(describeError(err)))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

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

  if (data.status === "no-profile" || data.status === "no-plan") {
    const needsProfile = data.status === "no-profile";
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Peer Comparison</Text>
        <Text style={styles.body}>
          {needsProfile
            ? "Set up your profile so we can find investors like you."
            : "Start a plan so we can compare your portfolio with similar investors."}
        </Text>
        <Pressable style={styles.submitButton} onPress={needsProfile ? onEditProfile : onStartPlan}>
          <Text style={styles.submitButtonText}>{needsProfile ? "Set up profile" : "Start a plan"}</Text>
        </Pressable>
      </View>
    );
  }

  if (data.status !== "ok") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Peer Comparison</Text>
        <Text style={styles.body}>Fund data isn't available yet. Please try again later.</Text>
      </View>
    );
  }

  const { report, population } = data;

  if (report.suppressed) {
    return (
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>Peer Comparison</Text>
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.cardHeading}>Not enough investors to compare yet</Text>
          <Text style={styles.body}>
            To protect privacy, comparisons are only shown once enough investors are in the pool. Check back later, or look at the
            Explore tab.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Peer Comparison</Text>

      {report.headline && <Headline headline={report.headline} />}

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Your peer cohort</Text>
        <View style={styles.chipWrap}>
          {report.identity.map((label) => (
            <View key={label} style={styles.identityChip}>
              <Text style={styles.identityChipText}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.hint}>
          Broad labels from your profile. The investors behind each comparison below are chosen for the metric being compared, using profile details only, never how their investments performed.
        </Text>
        <Pressable onPress={onEditProfile}>
          <Text style={styles.link}>Not right? Update your profile</Text>
        </Pressable>
      </View>

      {report.group && <GroupCard group={report.group} />}

      <Text style={styles.sectionHeading}>How you compare</Text>
      {report.cards.map((card) => (
        <ComparisonCard key={card.key} card={card} />
      ))}

      {report.observation && (
        <View style={[styles.card, styles.noteCard]}>
          <Text style={styles.subHeading}>What stands out</Text>
          <Text style={styles.body}>{report.observation}</Text>
        </View>
      )}

      <Text style={styles.footnote}>
        About {population.simulatedPct}% of the {population.size} investors compared are simulated, with income calibrated to published
        Singapore statistics; expense and contribution patterns are assumptions. Peers are shown only as medians and ranges,
        never as individuals.
      </Text>
    </ScrollView>
  );
}

function Headline({ headline }: { headline: NonNullable<CohortReport["headline"]> }) {
  const window = headline.windowMonths >= 12 ? "the last 12 months" : `the last ${headline.windowMonths} month${headline.windowMonths === 1 ? "" : "s"}`;
  return (
    <View style={styles.card}>
      <Text style={styles.headlineText}>
        Your portfolio returned <Text style={styles.headlineYou}>{pct(headline.you)}</Text>
        {headline.peerMedian !== null ? (
          <>
            . Similar portfolios with the same risk level returned a median of <Text style={styles.strong}>{pct(headline.peerMedian)}</Text>
          </>
        ) : null}
        .
      </Text>
      <View style={styles.threeRow}>
        <Figure label="Your portfolio" value={pct(headline.you)} highlight />
        <Figure label="Similar investors" value={headline.peerMedian === null ? "—" : pct(headline.peerMedian)} />
        <Figure label={headline.benchmark?.label ?? "Benchmark"} value={headline.benchmark ? pct(headline.benchmark.returnPct) : "—"} />
      </View>
      <Text style={styles.hint}>
        Total return over {window}, as of the latest fund data.
        {headline.benchmark ? ` The benchmark is a plain ${headline.benchmark.label.toLowerCase()} mix, rebalanced monthly.` : ""}
      </Text>
    </View>
  );
}

function Figure({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureValue, highlight && styles.figureValueHighlight]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

function GroupCard({ group }: { group: NonNullable<CohortReport["group"]> }) {
  const [lo, hi] = group.ageRange;
  const [cLo, cHi] = group.contributionRange;
  const mix = (Object.keys(RISK_NAMES) as Risk[])
    .filter((r) => group.risk[r] > 0)
    .map((r) => `${RISK_NAMES[r]} ${Math.round(group.risk[r])}%`)
    .join(" · ");
  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>Your peer group</Text>
      <Row label="Investors" value={String(group.size)} />
      <Row label="Age range" value={`${lo}–${hi}`} />
      <Row label="Monthly investment" value={`$${Math.round(cLo)}–$${Math.round(cHi)}`} />
      <Row label="Risk level" value={mix} />
      <Text style={styles.hint}>
        Investors with a similar profile: income, spare income each month, life stage and risk level. Ranges cover the middle 80%.
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ComparisonCard({ card }: { card: Card }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>{card.label}</Text>
      {card.status !== "ok" ? (
        <Text style={styles.body}>
          {card.message ?? (card.status === "withheld" ? "Too few comparable investors to show this privately." : "Not available yet.")}
        </Text>
      ) : (
        <>
          <View style={styles.threeRow}>
            <Figure label="You" value={fmt(card, card.you!)} highlight />
            <Figure label="Peer median" value={fmt(card, card.median!)} />
            <Figure label={card.percentile! >= 50 ? "Position" : "of peers"} value={position(card.percentile!, card.topPct!)} />
          </View>
          <Text style={styles.hint}>
            Middle half of peers: {fmt(card, card.p25!)} to {fmt(card, card.p75!)}
          </Text>
          {card.detail && (
            <Text style={styles.hint}>
              {card.detail.label}: <Text style={styles.strong}>{card.detail.you.toFixed(0)}%</Text> vs peer median{" "}
              {card.detail.median.toFixed(0)}%
            </Text>
          )}
          <Text style={styles.basis}>
            Compared with {card.cohortSize} investors {card.filter ? `at the ${card.filter}, with ` : "with "}
            {card.basis}.
            {card.relaxations.length > 0 ? ` Too few matched exactly, so we ${card.relaxations.join("; ")}.` : ""}
          </Text>
        </>
      )}
    </View>
  );
}

/** "Top 12%" for the upper half; below the median, the share of peers you're above. */
function position(percentile: number, topPct: number): string {
  if (percentile >= 50) return `Top ${topPct}%`;
  return percentile <= 0 ? "Lowest" : `Above ${percentile}%`;
}

function fmt(card: Card, v: number): string {
  if (card.unit === "score") return `${Math.round(v)}/100`;
  if (card.unit === "ratio") return v.toFixed(2);
  return `${v.toFixed(1)}%`;
}

const pct = (v: number) => `${v.toFixed(1)}%`;

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
  sectionHeading: { fontSize: 18, fontWeight: "700", alignSelf: "flex-start", width: "100%", maxWidth: 360, marginTop: 4 },
  body: { fontSize: 14, color: "#555" },
  strong: { fontWeight: "700", color: "#333" },
  hint: { fontSize: 12, color: "#777" },
  basis: { fontSize: 12, color: "#777", borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 8 },
  footnote: { fontSize: 11, color: "#999", textAlign: "center", maxWidth: 360, marginTop: 4 },
  error: { color: "#c0392b", textAlign: "center" },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 10 },
  warnCard: { borderColor: "#e0b34d", backgroundColor: "#fff8e6" },
  noteCard: { backgroundColor: "#f4f8ff", borderColor: "#cddcf7" },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  subHeading: { fontSize: 13, fontWeight: "600", color: "#333" },
  headlineText: { fontSize: 17, lineHeight: 24, color: "#333" },
  headlineYou: { fontWeight: "700", color: "#2e6fdb" },
  threeRow: { flexDirection: "row", gap: 8 },
  figure: { flex: 1, alignItems: "center", gap: 2, backgroundColor: "#f7f7f9", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 4 },
  figureValue: { fontSize: 15, fontWeight: "700", color: "#333" },
  figureValueHighlight: { color: "#2e6fdb" },
  figureLabel: { fontSize: 11, color: "#666", textAlign: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  identityChip: { borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#eaf1fd" },
  identityChipText: { color: "#2e6fdb", fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 14, color: "#555" },
  rowValue: { fontSize: 14, fontWeight: "600", color: "#333", flexShrink: 1, textAlign: "right" },
  submitButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 14, paddingHorizontal: 24, alignItems: "center", marginTop: 4 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { fontSize: 13, color: "#2e6fdb", fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
