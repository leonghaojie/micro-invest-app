/**
 * One person's full holdings (DECISIONS.md #12), opened by tapping them in the
 * Friends > Holdings list. Their own screen, so a portfolio with dozens of
 * funds scrolls here instead of flooding the friends list. Shows an
 * asset-class bar, then each fund with its weight (percent only, never an
 * amount) and a mark on funds the viewer also holds. Long portfolios show the
 * largest funds first, a search box, and a "Show all" toggle.
 *
 * `friendshipId` is the handle from GET /friends/holdings — or "me" for the
 * viewer's own holdings. Never a user id.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS, MixBar, MixLegend } from "../components/charts/MixBar";
import type { RootStackScreenProps } from "../navigation/AppNavigator";
import { KeyboardScreen } from "../components/KeyboardScreen";

type Props = RootStackScreenProps<"FriendHoldings">;

interface HoldingRow {
  ticker: string;
  name: string;
  assetClass: string;
  weightPct: number;
  youHold: boolean;
}

interface MemberHoldings {
  displayName: string;
  portfolioName: string | null;
  holdings: HoldingRow[];
}

const PAGE = 10; // funds shown before "Show all"
const SEARCH_FROM = 15; // show a search box once a portfolio has more funds than this

export function FriendHoldingsScreen({ route }: Props) {
  const { friendshipId } = route.params;
  const isMe = friendshipId === "me";

  const [data, setData] = useState<MemberHoldings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<MemberHoldings>(`/friends/holdings/${encodeURIComponent(friendshipId)}`)
      .then((res) => {
        if (!cancelled) setData(res);
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
  }, [friendshipId]);

  useFocusEffect(load);

  const mix = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const h of data?.holdings ?? []) byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.weightPct);
    return [...byClass.entries()].map(([assetClass, pct]) => ({ assetClass, pct })).sort((a, b) => b.pct - a.pct);
  }, [data]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "Couldn't load these holdings."}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = q
    ? data.holdings.filter((h) => h.ticker.toLowerCase().includes(q) || h.name.toLowerCase().includes(q))
    : data.holdings;
  const paged = !q && !showAll && matches.length > PAGE;
  const shown = paged ? matches.slice(0, PAGE) : matches;
  const sharedCount = data.holdings.filter((h) => h.youHold).length;

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.name}>{isMe ? `${data.displayName} (you)` : data.displayName}</Text>
        <Text style={styles.sub}>
          {data.portfolioName ?? "Custom mix"} · {data.holdings.length} fund{data.holdings.length === 1 ? "" : "s"}
        </Text>
        {!isMe && sharedCount > 0 && (
          <Text style={styles.shared}>
            You hold {sharedCount} of these fund{sharedCount === 1 ? "" : "s"} too.
          </Text>
        )}
        <MixBar entries={mix} />
        <MixLegend classes={mix.map((m) => m.assetClass)} />
      </View>

      {data.holdings.length > SEARCH_FROM && (
        <TextInput
          style={styles.search}
          placeholder={`Search ${data.holdings.length} funds`}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      )}

      <View style={styles.list}>
        {shown.map((h) => (
          <View key={h.ticker} style={styles.holding}>
            <View style={styles.holdingTop}>
              <View style={styles.holdingName}>
                <Text style={styles.ticker}>{h.ticker}</Text>
                <Text style={styles.fundName} numberOfLines={1}>
                  {h.name}
                </Text>
              </View>
              <Text style={styles.weight}>{formatPct(h.weightPct)}</Text>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.min(Math.max(h.weightPct, 0), 100)}%`, backgroundColor: ASSET_CLASS_COLORS[h.assetClass] ?? "#999" },
                ]}
              />
            </View>
            <View style={styles.meta}>
              <Text style={styles.assetClass}>{ASSET_CLASS_LABELS[h.assetClass] ?? h.assetClass}</Text>
              {!isMe && h.youHold && <Text style={styles.youHold}>You hold this too</Text>}
            </View>
          </View>
        ))}

        {q && matches.length === 0 && <Text style={styles.note}>No fund matches “{query.trim()}”.</Text>}
      </View>

      {paged && (
        <Pressable onPress={() => setShowAll(true)}>
          <Text style={styles.link}>Show all {matches.length} funds</Text>
        </Pressable>
      )}
      {!q && showAll && data.holdings.length > PAGE && (
        <Pressable onPress={() => setShowAll(false)}>
          <Text style={styles.link}>Show fewer</Text>
        </Pressable>
      )}

      <Text style={styles.note}>Weights are percentages of the portfolio — no amounts are shared.</Text>
    </KeyboardScreen>
  );
}

function formatPct(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "These holdings aren't available. They may have stopped sharing.";
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load these holdings. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  container: { alignItems: "center", padding: 24, gap: 12 },
  error: { color: "#c0392b", textAlign: "center" },
  link: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", paddingVertical: 6 },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 8 },
  name: { fontSize: 20, fontWeight: "700" },
  sub: { fontSize: 13, color: "#777" },
  shared: { fontSize: 13, color: "#2e6fdb", fontWeight: "600" },
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
  list: { width: "100%", maxWidth: 360, gap: 10 },
  holding: { gap: 4 },
  holdingTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  holdingName: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  ticker: { fontWeight: "700", color: "#333" },
  fundName: { flex: 1, fontSize: 12, color: "#777" },
  weight: { fontWeight: "700", color: "#333" },
  track: { height: 6, borderRadius: 3, backgroundColor: "#eee", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  meta: { flexDirection: "row", justifyContent: "space-between" },
  assetClass: { fontSize: 11, color: "#999" },
  youHold: { fontSize: 11, color: "#2e6fdb", fontWeight: "600" },
  note: { fontSize: 12, color: "#777", textAlign: "center", maxWidth: 360 },
});
