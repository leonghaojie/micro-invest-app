/**
 * Friends comparison — the "Friends" half of the Peers tab (DECISIONS.md #8, 3 Oct 2026; rankings on
 * the cohort measures: #22, #24; one-to-one comparison: #26, 7 Oct 2026). This is the one place named
 * individuals appear, as a consent-based exception to NFR-03 — the anonymous peer comparisons next
 * to it are untouched.
 *
 * A ranked list, per measure, of the user plus the friends who shared that measure
 * (GET /friends/comparison). Long boards are capped to the top few plus the user's own row, with a
 * "Show all" toggle. Tapping a friend's name opens FriendCompareScreen: that friend side by side
 * with the user, measures and holdings. Below the rankings is a list of every friend, so someone who
 * shares no measure can still be opened (and their holdings seen, if they share those).
 *
 * The user always sees their own figures; a friend's figures appear only if they opted in, and
 * friends who hide them are counted but never named.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { FRIEND_METRICS, FriendMetric, FriendMetricKey } from "../utils/friendMetrics";
import { METRIC_INFO } from "../utils/metricInfo";

interface BoardRow {
  /** Handle for opening the friend; null for the user's own row. */
  friendshipId: string | null;
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

interface FriendLink {
  friendshipId: string;
  displayName: string;
  /** Whether you have put this friend on your close-friends list (only you can see this). */
  close?: boolean;
}

interface Comparison {
  friendCount: number;
  friends: FriendLink[];
  /** How many months the return measures cover (0 when the user has no history yet). */
  windowMonths: number;
  metrics: Record<FriendMetricKey, MetricBoard>;
}

/** The cohort page's explanations, except where they describe the cohort's like-for-like risk groups. */
const FRIEND_INFO: Partial<Record<FriendMetricKey, (typeof METRIC_INFO)[FriendMetricKey]>> = {
  return: {
    ...METRIC_INFO.return,
    how: "Each month's return compounded together over the months shown above, so adding or withdrawing money does not distort it.",
    meaning: "Positive means the portfolio grew, negative that it shrank. A friend holding riskier investments is expected to swing more, so a higher figure is not automatically better.",
  },
  monthlyReturn: {
    ...METRIC_INFO.monthlyReturn,
    meaning: "Positive means the portfolio grew that month, negative that it shrank. A single month swings a lot, so it is a snapshot and not a trend, and a friend holding riskier investments is expected to swing more.",
  },
};

// Keep each page short however many friends there are.
const BOARD_TOP = 5; // rankings rows shown before "Show all"
const FRIEND_LIST_PAGE = 15; // friends shown in the friends list before "Show all"
const SEARCH_FROM = 8; // show a search box once there are more friends than this

export function FriendsComparison({ onManage }: { onManage: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<FriendMetricKey>("return");

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<Comparison>("/friends/comparison")
      .then((comparison) => {
        if (!cancelled) setData(comparison);
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

  function open(friendshipId: string, displayName: string) {
    navigation.navigate("FriendCompare", { friendshipId, displayName });
  }

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

  const meta = FRIEND_METRICS.find((m) => m.key === metric)!;

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Friends</Text>
      <Text style={styles.subtitle}>
        {data.friendCount} friend{data.friendCount === 1 ? "" : "s"} · only what each friend has chosen to share is shown. Tap a friend to compare with them one to one, holdings included.
      </Text>
      <View style={styles.chipWrap}>
        {FRIEND_METRICS.map((m) => (
          <Pressable key={m.key} style={[styles.chip, metric === m.key && styles.chipSelected]} onPress={() => setMetric(m.key)}>
            <Text style={[styles.chipText, metric === m.key && styles.chipTextSelected]}>{m.chip}</Text>
          </Pressable>
        ))}
      </View>
      <RankingsBoard board={data.metrics[metric]} meta={meta} windowMonths={data.windowMonths} onOpen={open} />
      <FriendList friends={data.friends} onOpen={open} />
      <Pressable style={styles.secondaryButton} onPress={onManage}>
        <Text style={styles.secondaryButtonText}>Manage friends & sharing →</Text>
      </Pressable>
    </ScrollView>
  );
}

/** One metric's ranking. With many friends it shows the top few plus the
 * user's own row (so they can always find themselves), and a toggle for the rest. */
function RankingsBoard({
  board,
  meta,
  windowMonths,
  onOpen,
}: {
  board: MetricBoard;
  meta: FriendMetric;
  windowMonths: number;
  onOpen: (friendshipId: string, displayName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const info = FRIEND_INFO[meta.key] ?? METRIC_INFO[meta.key];
  const overWindow = meta.key === "return" && windowMonths > 0;

  const collapsible = board.rows.length > BOARD_TOP + 1;
  const top = board.rows.slice(0, BOARD_TOP);
  const me = board.rows.find((r) => r.isMe);
  const meBelowTop = !!me && !top.includes(me);
  const visible = collapsible && !expanded ? top : board.rows;

  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>{meta.label}</Text>
      <Text style={styles.metricWhat}>{info.what}</Text>
      {overWindow && (
        <Text style={styles.note}>
          Everyone is measured over your last {windowMonths} month{windowMonths === 1 ? "" : "s"}, so the comparison is like for like.
        </Text>
      )}

      {board.rows.length === 0 && <Text style={styles.body}>Nothing to rank yet for this stat.</Text>}

      {visible.map((row, i) => (
        <BoardLine key={`${row.displayName}-${i}`} row={row} format={meta.format} onOpen={onOpen} />
      ))}

      {collapsible && !expanded && meBelowTop && me && (
        <>
          <Text style={styles.gap}>⋯</Text>
          <BoardLine row={me} format={meta.format} onOpen={onOpen} />
        </>
      )}

      {collapsible && (
        <Pressable onPress={() => setExpanded((e) => !e)}>
          <Text style={styles.toggleLink}>{expanded ? `Show top ${BOARD_TOP}` : `Show all ${board.rows.length}`}</Text>
        </Pressable>
      )}

      <Pressable onPress={() => setExplaining((e) => !e)} accessibilityRole="button">
        <Text style={styles.toggleLink}>{explaining ? "Hide explanation" : "What does this mean?"}</Text>
      </Pressable>
      {explaining && (
        <View style={styles.explain}>
          <Text style={styles.explainText}>{info.how}</Text>
          <Text style={styles.explainText}>{info.meaning}</Text>
        </View>
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

function BoardLine({ row, format, onOpen }: { row: BoardRow; format: (v: number) => string; onOpen: (friendshipId: string, displayName: string) => void }) {
  const friendshipId = row.friendshipId;
  const content = (
    <>
      <Text style={[styles.rank, row.isMe && styles.rowMeText]}>{row.rank}</Text>
      <Text style={[styles.name, row.isMe && styles.rowMeText]} numberOfLines={1}>
        {row.isMe ? `${row.displayName} (you)` : row.displayName}
      </Text>
      <Text style={[styles.value, row.isMe && styles.rowMeText]}>{format(row.value)}</Text>
      {!row.isMe && <Text style={styles.chevron}>›</Text>}
    </>
  );
  if (row.isMe || friendshipId === null) return <View style={[styles.row, styles.rowMe]}>{content}</View>;
  return (
    <Pressable
      style={styles.row}
      onPress={() => onOpen(friendshipId, row.displayName)}
      accessibilityRole="button"
      accessibilityLabel={`Compare with ${row.displayName}`}
    >
      {content}
    </Pressable>
  );
}

/** Every friend, by name: the way in for someone who shares no measure (their holdings, if shared, are on their page). */
function FriendList({ friends, onOpen }: { friends: FriendLink[]; onOpen: (friendshipId: string, displayName: string) => void }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = q ? friends.filter((f) => f.displayName.toLowerCase().includes(q)) : friends;
  const paged = !q && !showAll && matches.length > FRIEND_LIST_PAGE;
  const shown = paged ? matches.slice(0, FRIEND_LIST_PAGE) : matches;

  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>Compare with a friend</Text>
      {friends.length > SEARCH_FROM && (
        <TextInput
          style={styles.search}
          placeholder={`Search ${friends.length} friends`}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      )}
      {q && matches.length === 0 && <Text style={styles.note}>No friend matches “{query.trim()}”.</Text>}
      {shown.map((f) => (
        <Pressable
          key={f.friendshipId}
          style={styles.row}
          onPress={() => onOpen(f.friendshipId, f.displayName)}
          accessibilityRole="button"
          accessibilityLabel={`Compare with ${f.displayName}`}
        >
          <Text style={styles.name} numberOfLines={1}>
            {f.close ? "★ " : ""}
            {f.displayName}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
      {paged && (
        <Pressable onPress={() => setShowAll(true)}>
          <Text style={styles.toggleLink}>Show all {matches.length} friends</Text>
        </Pressable>
      )}
      <Text style={styles.note}>Friends see your holdings only if you turn on “Holdings” in your sharing settings.</Text>
    </View>
  );
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
  metricWhat: { fontSize: 13, color: "#555" },
  explain: { gap: 6, backgroundColor: "#f7f7f7", borderRadius: 6, padding: 10 },
  explainText: { fontSize: 13, color: "#444" },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 6 },
  rowMe: { backgroundColor: "#eaf1fd" },
  rowMeText: { color: "#2e6fdb", fontWeight: "700" },
  rank: { width: 24, fontWeight: "600", color: "#555" },
  name: { flex: 1, color: "#333" },
  value: { fontWeight: "600", color: "#333" },
  chevron: { fontSize: 20, color: "#999", width: 12, textAlign: "right" },
  gap: { textAlign: "center", color: "#999", letterSpacing: 4 },
  toggleLink: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", paddingVertical: 6 },
  note: { fontSize: 12, color: "#777", marginTop: 4 },
  search: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fff",
  },
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
