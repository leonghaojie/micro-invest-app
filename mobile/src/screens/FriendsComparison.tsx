/**
 * Friends comparison — the "Friends" half of the Peers tab (DECISIONS.md
 * #8, 3 Oct 2026; holdings: #12, 4 Oct 2026). This is the one place named
 * individuals appear, as a consent-based exception to NFR-03 — the anonymous
 * income-range comparison next to it is untouched.
 *
 * Two views, switched at the top:
 *  - Rankings: a ranked list, per metric, of the user plus the friends who
 *    shared that metric (GET /friends/comparison). Long boards are capped to
 *    the top few plus the user's own row, with a "Show all" toggle.
 *  - Holdings: a compact list of friends who share their holdings
 *    (GET /friends/holdings). Tapping a name opens that person's full holdings
 *    on their own screen (FriendHoldingsScreen), so a long friends list or a
 *    portfolio with dozens of funds never floods this page.
 *
 * The user always sees their own figures; a friend's figures appear only if
 * they opted in, and friends who hide them are counted but never named.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import { MixBar, MixLegend } from "../components/charts/MixBar";
import type { RootStackParamList } from "../navigation/AppNavigator";

interface HoldingsSummary {
  /** null for the user themselves (opened as "me"). */
  friendshipId: string | null;
  displayName: string;
  portfolioName: string | null;
  fundCount: number;
  /** Funds in this portfolio that the user also holds. */
  sharedFundCount: number;
  mix: { assetClass: string; pct: number }[];
}

interface HoldingsOverview {
  friendCount: number;
  me: HoldingsSummary | null;
  friends: HoldingsSummary[];
  hiddenCount: number;
  noPlanCount: number;
}

type MetricKey = "value" | "returnPct" | "contributionRatePct" | "savingsRatePct" | "emergencyBuffer";

interface BoardRow {
  displayName: string;
  isMe: boolean;
  value: number;
  rank: number;
}

interface MetricBoard {
  rows: BoardRow[];
  hiddenCount: number;
  noDataCount: number;
}

interface Comparison {
  friendCount: number;
  metrics: Record<MetricKey, MetricBoard>;
}

const METRICS: { key: MetricKey; label: string; format: (v: number) => string }[] = [
  { key: "value", label: "Value", format: formatCurrency },
  { key: "returnPct", label: "Return", format: (v) => `${v.toFixed(1)}%` },
  { key: "contributionRatePct", label: "Contribution rate", format: (v) => `${v.toFixed(1)}%` },
  { key: "savingsRatePct", label: "Savings rate", format: (v) => `${v.toFixed(1)}%` },
  { key: "emergencyBuffer", label: "Emergency buffer", format: (v) => `${v.toFixed(1)}x` },
];

// Keep each page short however many friends there are.
const BOARD_TOP = 5; // rankings rows shown before "Show all"
const FRIEND_LIST_PAGE = 15; // friends shown in the Holdings list before "Show all"
const SEARCH_FROM = 8; // show a search box once there are more friends than this

export function FriendsComparison({ onManage }: { onManage: () => void }) {
  const [data, setData] = useState<Comparison | null>(null);
  const [holdings, setHoldings] = useState<HoldingsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("value");
  const [view, setView] = useState<"rankings" | "holdings">("rankings");

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([apiFetch<Comparison>("/friends/comparison"), apiFetch<HoldingsOverview>("/friends/holdings")])
      .then(([comparison, overview]) => {
        if (!cancelled) {
          setData(comparison);
          setHoldings(overview);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error ?? "Couldn't load your friends comparison."}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (data.friendCount === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Friends</Text>
        <Text style={styles.subtitle}>
          Add friends to see how you compare with people you know. You choose exactly which of your stats they can see.
        </Text>
        <Pressable style={styles.submitButton} onPress={onManage}>
          <Text style={styles.submitButtonText}>Add friends</Text>
        </Pressable>
      </View>
    );
  }

  const header = (
    <>
      <Text style={styles.title}>Friends</Text>
      <Text style={styles.subtitle}>
        {data.friendCount} friend{data.friendCount === 1 ? "" : "s"} · only what each friend has chosen to share is shown.
      </Text>
      <View style={styles.segment}>
        {(["rankings", "holdings"] as const).map((v) => (
          <Pressable key={v} style={[styles.segmentButton, view === v && styles.segmentButtonSelected]} onPress={() => setView(v)}>
            <Text style={[styles.segmentText, view === v && styles.segmentTextSelected]}>{v === "rankings" ? "Rankings" : "Holdings"}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
  const footer = (
    <Pressable style={styles.secondaryButton} onPress={onManage}>
      <Text style={styles.secondaryButtonText}>Manage friends & sharing →</Text>
    </Pressable>
  );

  if (view === "holdings" && holdings) {
    return (
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {header}
        <HoldingsList overview={holdings} />
        {footer}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      {header}
      <View style={styles.chipWrap}>
        {METRICS.map((m) => (
          <Pressable key={m.key} style={[styles.chip, metric === m.key && styles.chipSelected]} onPress={() => setMetric(m.key)}>
            <Text style={[styles.chipText, metric === m.key && styles.chipTextSelected]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      <RankingsBoard board={data.metrics[metric]} metric={METRICS.find((m) => m.key === metric)!} />
      {footer}
    </ScrollView>
  );
}

/** One metric's ranking. With many friends it shows the top few plus the
 * user's own row (so they can always find themselves), and a toggle for the rest. */
function RankingsBoard({ board, metric }: { board: MetricBoard; metric: { label: string; format: (v: number) => string } }) {
  const [expanded, setExpanded] = useState(false);

  const collapsible = board.rows.length > BOARD_TOP + 1;
  const top = board.rows.slice(0, BOARD_TOP);
  const me = board.rows.find((r) => r.isMe);
  const meBelowTop = !!me && !top.includes(me);
  const visible = collapsible && !expanded ? top : board.rows;

  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>{metric.label}</Text>

      {board.rows.length === 0 && <Text style={styles.body}>Nothing to rank yet for this stat.</Text>}

      {visible.map((row, i) => (
        <BoardLine key={`${row.displayName}-${i}`} row={row} format={metric.format} />
      ))}

      {collapsible && !expanded && meBelowTop && me && (
        <>
          <Text style={styles.gap}>⋯</Text>
          <BoardLine row={me} format={metric.format} />
        </>
      )}

      {collapsible && (
        <Pressable onPress={() => setExpanded((e) => !e)}>
          <Text style={styles.toggleLink}>{expanded ? `Show top ${BOARD_TOP}` : `Show all ${board.rows.length}`}</Text>
        </Pressable>
      )}

      {board.hiddenCount > 0 && (
        <Text style={styles.note}>
          {board.hiddenCount} friend{board.hiddenCount === 1 ? " doesn't" : "s don't"} share this stat.
        </Text>
      )}
      {board.noDataCount > 0 && (
        <Text style={styles.note}>
          {board.noDataCount} friend{board.noDataCount === 1 ? " has" : "s have"} no figure yet.
        </Text>
      )}
    </View>
  );
}

function BoardLine({ row, format }: { row: BoardRow; format: (v: number) => string }) {
  return (
    <View style={[styles.row, row.isMe && styles.rowMe]}>
      <Text style={[styles.rank, row.isMe && styles.rowMeText]}>{row.rank}</Text>
      <Text style={[styles.name, row.isMe && styles.rowMeText]} numberOfLines={1}>
        {row.isMe ? `${row.displayName} (you)` : row.displayName}
      </Text>
      <Text style={[styles.value, row.isMe && styles.rowMeText]}>{format(row.value)}</Text>
    </View>
  );
}

/** Who shares their holdings (DECISIONS.md #12): one compact row per person —
 * name, portfolio, fund count, a small asset-class bar. Tap to open the full
 * holdings on their own screen. The user's own row is pinned first. */
function HoldingsList({ overview }: { overview: HoldingsOverview }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? overview.friends.filter((f) => f.displayName.toLowerCase().includes(q)) : overview.friends),
    [overview.friends, q]
  );
  const paged = !q && !showAll && matches.length > FRIEND_LIST_PAGE;
  const shown = paged ? matches.slice(0, FRIEND_LIST_PAGE) : matches;

  const classes = useMemo(
    () => [...new Set([...(overview.me ? [overview.me] : []), ...overview.friends].flatMap((m) => m.mix.map((e) => e.assetClass)))],
    [overview]
  );

  function open(person: HoldingsSummary) {
    navigation.navigate("FriendHoldings", { friendshipId: person.friendshipId ?? "me", displayName: person.displayName });
  }

  return (
    <>
      {classes.length > 0 && <MixLegend classes={classes} />}

      {overview.friends.length > SEARCH_FROM && (
        <TextInput
          style={styles.search}
          placeholder={`Search ${overview.friends.length} friends`}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      )}

      {overview.me && !q && <HoldingsRow person={overview.me} isMe onPress={() => open(overview.me!)} />}

      {overview.friends.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.body}>
            {overview.friendCount === 0 ? "Add friends to see what they invest in." : "None of your friends are sharing their holdings yet."}
          </Text>
        </View>
      )}

      {q && matches.length === 0 && <Text style={styles.panelNote}>No friend matches “{query.trim()}”.</Text>}

      {shown.map((f) => (
        <HoldingsRow key={f.friendshipId ?? f.displayName} person={f} onPress={() => open(f)} />
      ))}

      {paged && (
        <Pressable onPress={() => setShowAll(true)}>
          <Text style={styles.toggleLink}>Show all {matches.length} friends</Text>
        </Pressable>
      )}

      {overview.hiddenCount > 0 && (
        <Text style={styles.panelNote}>
          {overview.hiddenCount} friend{overview.hiddenCount === 1 ? " keeps" : "s keep"} their holdings private.
        </Text>
      )}
      {overview.noPlanCount > 0 && (
        <Text style={styles.panelNote}>
          {overview.noPlanCount} friend{overview.noPlanCount === 1 ? " shares" : "s share"} holdings but{" "}
          {overview.noPlanCount === 1 ? "hasn't" : "haven't"} started a plan yet.
        </Text>
      )}
      <Text style={styles.panelNote}>Friends see your holdings only if you turn on “Holdings” in your sharing settings.</Text>
    </>
  );
}

function HoldingsRow({ person, isMe, onPress }: { person: HoldingsSummary; isMe?: boolean; onPress: () => void }) {
  const detail = [
    person.portfolioName ?? "Custom mix",
    `${person.fundCount} fund${person.fundCount === 1 ? "" : "s"}`,
    !isMe && person.sharedFundCount > 0 ? `${person.sharedFundCount} in common` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable style={[styles.personRow, isMe && styles.cardMe]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${person.displayName}'s holdings`}>
      <View style={styles.personMain}>
        <Text style={[styles.personName, isMe && styles.rowMeText]} numberOfLines={1}>
          {isMe ? `${person.displayName} (you)` : person.displayName}
        </Text>
        <Text style={styles.personDetail} numberOfLines={1}>
          {detail}
        </Text>
        <MixBar entries={person.mix} />
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load your friends comparison. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 8, textAlign: "center", maxWidth: 360 },
  body: { fontSize: 14, color: "#555", textAlign: "center" },
  error: { color: "#c0392b", textAlign: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 360 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#2e6fdb", fontWeight: "600" },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  cardMe: { backgroundColor: "#f5f9ff", borderColor: "#2e6fdb" },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 6 },
  rowMe: { backgroundColor: "#eaf1fd" },
  rowMeText: { color: "#2e6fdb", fontWeight: "700" },
  rank: { width: 24, fontWeight: "600", color: "#555" },
  name: { flex: 1, color: "#333" },
  value: { fontWeight: "600", color: "#333" },
  gap: { textAlign: "center", color: "#999", letterSpacing: 4 },
  toggleLink: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", paddingVertical: 6 },
  note: { fontSize: 12, color: "#777", marginTop: 4 },
  panelNote: { fontSize: 12, color: "#777", textAlign: "center", maxWidth: 360 },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: "#ccc", borderRadius: 8, overflow: "hidden", width: "100%", maxWidth: 360 },
  segmentButton: { flex: 1, paddingVertical: 8, alignItems: "center" },
  segmentButtonSelected: { backgroundColor: "#eaf1fd" },
  segmentText: { color: "#555", fontWeight: "600" },
  segmentTextSelected: { color: "#2e6fdb" },
  search: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  personRow: {
    width: "100%",
    maxWidth: 360,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  personMain: { flex: 1, gap: 4 },
  personName: { fontSize: 16, fontWeight: "600", color: "#222" },
  personDetail: { fontSize: 12, color: "#777" },
  chevron: { fontSize: 24, color: "#999" },
  submitButton: {
    backgroundColor: "#2e6fdb",
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
