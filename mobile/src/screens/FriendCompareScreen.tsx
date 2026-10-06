/**
 * One friend side by side with you (DECISIONS.md #26), opened by tapping their name on the Friends
 * rankings (or in the list of friends below them). Two parts:
 *  - the measures: your figure and theirs, for each measure they share;
 *  - the holdings: the asset-class mix of each of you, and each fund with both weights, with the
 *    funds you both hold marked. Percentages only, never amounts.
 *
 * Only what the friend has chosen to share is shown, and a figure that is private looks exactly
 * like one that is missing ("—"), so nothing here says what they have switched off.
 *
 * `friendshipId` is the handle from GET /friends/comparison. Never a user id.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { ASSET_CLASS_LABELS, MixBar, MixEntry, MixLegend } from "../components/charts/MixBar";
import { KeyboardScreen } from "../components/KeyboardScreen";
import type { RootStackScreenProps } from "../navigation/AppNavigator";
import { FRIEND_METRICS, FriendMetricKey } from "../utils/friendMetrics";

type Props = RootStackScreenProps<"FriendCompare">;

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

interface FriendComparison {
  displayName: string;
  /** Whether you have put this friend on your close-friends list (only you can see this). */
  close: boolean;
  windowMonths: number;
  metrics: Record<FriendMetricKey, { me: number | null; friend: number | null }>;
  holdings: { me: MemberHoldings; friend: MemberHoldings; myMix: MixEntry[]; friendMix: MixEntry[] } | null;
}

const FUNDS_SHOWN = 8; // funds listed before "Show all"

export function FriendCompareScreen({ route }: Props) {
  const { friendshipId } = route.params;
  const [data, setData] = useState<FriendComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [closeChoice, setCloseChoice] = useState<boolean | null>(null);

  function toggleClose(next: boolean) {
    setCloseChoice(next); // optimistic; the friend is never told
    apiFetch(`/friends/${encodeURIComponent(friendshipId)}/close`, { method: "PUT", body: { close: next } }).catch(() => setCloseChoice(!next));
  }

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<FriendComparison>(`/friends/${encodeURIComponent(friendshipId)}/compare`)
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

  // Every fund either of you holds, with both weights (0 where one of you does not hold it), largest first.
  const funds = useMemo(() => {
    if (!data?.holdings) return [];
    const byTicker = new Map<string, { ticker: string; name: string; assetClass: string; mine: number; theirs: number }>();
    for (const h of data.holdings.me.holdings) byTicker.set(h.ticker, { ticker: h.ticker, name: h.name, assetClass: h.assetClass, mine: h.weightPct, theirs: 0 });
    for (const h of data.holdings.friend.holdings) {
      const row = byTicker.get(h.ticker);
      if (row) row.theirs = h.weightPct;
      else byTicker.set(h.ticker, { ticker: h.ticker, name: h.name, assetClass: h.assetClass, mine: 0, theirs: h.weightPct });
    }
    return [...byTicker.values()].sort((a, b) => Math.max(b.mine, b.theirs) - Math.max(a.mine, a.theirs) || a.ticker.localeCompare(b.ticker));
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
        <Text style={styles.error}>{error ?? "Couldn't load this comparison."}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const name = data.displayName;
  const isClose = closeChoice ?? data.close;
  const inCommon = funds.filter((f) => f.mine > 0 && f.theirs > 0).length;
  const shownFunds = showAll ? funds : funds.slice(0, FUNDS_SHOWN);
  const classes = data.holdings ? [...new Set([...data.holdings.myMix, ...data.holdings.friendMix].map((e) => e.assetClass))] : [];

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>You and {name}</Text>
      <Pressable
        style={[styles.closeButton, isClose && styles.closeButtonOn]}
        onPress={() => toggleClose(!isClose)}
        accessibilityRole="button"
        accessibilityState={{ selected: isClose }}
      >
        <Text style={[styles.closeText, isClose && styles.closeTextOn]}>{isClose ? "★ Close friend" : "☆ Add to close friends"}</Text>
      </Pressable>
      <Text style={styles.note}>Only you see your close-friends list; {name} is never told.</Text>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>How you compare</Text>
        <View style={[styles.row, styles.headRow]}>
          <Text style={[styles.cell, styles.labelCell, styles.head]}> </Text>
          <Text style={[styles.cell, styles.head]}>You</Text>
          <Text style={[styles.cell, styles.head]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        {FRIEND_METRICS.map((m) => {
          const { me, friend } = data.metrics[m.key];
          return (
            <View key={m.key} style={styles.row}>
              <Text style={[styles.cell, styles.labelCell]}>{m.chip}</Text>
              <Text style={[styles.cell, styles.you]}>{me === null ? "—" : m.format(me)}</Text>
              <Text style={styles.cell}>{friend === null ? "—" : m.format(friend)}</Text>
            </View>
          );
        })}
        <Text style={styles.note}>
          {data.windowMonths > 0 ? `Return is measured over your last ${data.windowMonths} month${data.windowMonths === 1 ? "" : "s"} for both of you. ` : ""}
          A dash means nothing is shown.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>What you hold</Text>
        {data.holdings === null ? (
          <Text style={styles.body}>{name}'s holdings aren't available to you.</Text>
        ) : (
          <>
            <MixBar label="You" entries={data.holdings.myMix} />
            <MixBar label={name} entries={data.holdings.friendMix} />
            <MixLegend classes={classes} />
            <Text style={styles.shared}>
              {inCommon === 0 ? "You have no funds in common." : `You hold ${inCommon} fund${inCommon === 1 ? "" : "s"} in common.`}
            </Text>

            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.cell, styles.fundCell, styles.head]}>Fund</Text>
              <Text style={[styles.cell, styles.weightCell, styles.head]}>You</Text>
              <Text style={[styles.cell, styles.weightCell, styles.head]} numberOfLines={1}>
                {name}
              </Text>
            </View>
            {shownFunds.map((f) => {
              const both = f.mine > 0 && f.theirs > 0;
              return (
                <View key={f.ticker} style={[styles.row, both && styles.bothRow]}>
                  <View style={[styles.cell, styles.fundCell]}>
                    <Text style={styles.ticker}>{f.ticker}</Text>
                    <Text style={styles.fundName} numberOfLines={1}>
                      {f.name} · {ASSET_CLASS_LABELS[f.assetClass] ?? f.assetClass}
                    </Text>
                  </View>
                  <Text style={[styles.cell, styles.weightCell, styles.you]}>{f.mine > 0 ? formatPct(f.mine) : "—"}</Text>
                  <Text style={[styles.cell, styles.weightCell]}>{f.theirs > 0 ? formatPct(f.theirs) : "—"}</Text>
                </View>
              );
            })}
            {funds.length > FUNDS_SHOWN && (
              <Pressable onPress={() => setShowAll((v) => !v)}>
                <Text style={styles.link}>{showAll ? `Show the top ${FUNDS_SHOWN}` : `Show all ${funds.length} funds`}</Text>
              </Pressable>
            )}
            <Text style={styles.note}>Shaded rows are funds you both hold. Weights are percentages of each portfolio, no amounts are shared.</Text>
          </>
        )}
      </View>

      <Text style={styles.note}>Only what {name} has chosen to share is shown.</Text>
    </KeyboardScreen>
  );
}

function formatPct(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "This friend isn't available. They may have removed the connection.";
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load this comparison. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  container: { alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  closeButton: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  closeButtonOn: { borderColor: "#e0a800", backgroundColor: "#fff6d6" },
  closeText: { fontSize: 13, color: "#555", fontWeight: "600" },
  closeTextOn: { color: "#8a6a00" },
  error: { color: "#c0392b", textAlign: "center" },
  link: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", paddingVertical: 6 },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 8 },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 14, color: "#555" },
  shared: { fontSize: 13, color: "#2e6fdb", fontWeight: "600" },
  note: { fontSize: 12, color: "#777" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7, paddingHorizontal: 4, borderRadius: 6 },
  headRow: { borderBottomWidth: 1, borderBottomColor: "#eee", borderRadius: 0 },
  bothRow: { backgroundColor: "#eaf1fd" },
  cell: { flex: 1, fontSize: 13, color: "#333", textAlign: "right" },
  labelCell: { flex: 1.6, textAlign: "left" },
  fundCell: { flex: 2.4, textAlign: "left" },
  weightCell: { flex: 1 },
  head: { fontSize: 11, color: "#777", fontWeight: "600" },
  you: { color: "#2e6fdb", fontWeight: "700" },
  ticker: { fontWeight: "700", color: "#333", textAlign: "left" },
  fundName: { fontSize: 11, color: "#777", textAlign: "left" },
});
