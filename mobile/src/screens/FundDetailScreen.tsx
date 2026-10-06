/**
 * One fund's history and statistics (DECISIONS.md #14), opened by tapping a
 * fund in the Funds tab. Shows how the fund has actually moved so a user can
 * judge it before putting money in:
 *   - growth of 100 over a chosen range (dividends reinvested), drag to read;
 *   - key statistics for that range: total and annualised return, volatility,
 *     worst fall (max drawdown), best / worst month, share of up months, and
 *     the trailing dividend yield;
 *   - the last 36 monthly returns as bars, and calendar-year returns.
 *
 * Figures are in Singapore dollars (DECISIONS.md #29): a fund listed in US dollars is converted at
 * month-end rates, so its return includes the currency move. They come from monthly data and
 * describe the past only — the screen says so. Nothing here is a recommendation.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { LineChart } from "../components/charts/LineChart";
import { ASSET_CLASS_LABELS } from "../components/charts/MixBar";
import { ReturnBars } from "../components/charts/ReturnBars";
import type { RootStackScreenProps } from "../navigation/AppNavigator";

type Props = RootStackScreenProps<"FundDetail">;

type RangeKey = "1y" | "3y" | "5y" | "10y" | "max";

interface MonthReturn {
  month: string;
  returnPct: number;
}

interface FundDetail {
  fund: {
    id: string;
    ticker: string;
    name: string;
    assetClass: string;
    exchange: string;
    currency: string;
    monthsAvailable: number;
    earliestMonth: string;
  };
  range: RangeKey;
  months: number;
  startMonth: string;
  endMonth: string;
  availableRanges: RangeKey[];
  series: { month: string; growth: number }[];
  stats: {
    totalReturnPct: number;
    annualizedReturnPct: number | null;
    volatilityPct: number | null;
    maxDrawdownPct: number;
    bestMonth: MonthReturn;
    worstMonth: MonthReturn;
    positiveMonthsPct: number;
  };
  recentMonths: MonthReturn[];
  calendarYears: { year: number; returnPct: number; partial: boolean }[];
  trailingYieldPct: number | null;
  latestPrice: number;
  /** The latest price in the fund's own currency. */
  latestPriceLocal: number;
}

const RANGE_LABELS: Record<RangeKey, string> = { "1y": "1Y", "3y": "3Y", "5y": "5Y", "10y": "10Y", max: "Max" };
const GAIN = "#1e8449";
const LOSS = "#c0392b";

export function FundDetailScreen({ route, navigation }: Props) {
  const { fundId } = route.params;
  const [position, setPosition] = useState<{ cash: number; held: { value: number; costBasis: number } | null } | null>(null);

  const [range, setRange] = useState<RangeKey | null>(null); // null = let the server pick its default
  const [data, setData] = useState<FundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<FundDetail>(`/portfolio/funds/${encodeURIComponent(fundId)}${range ? `?range=${range}` : ""}`)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setActive(null);
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
  }, [fundId, range]);

  useFocusEffect(load);

  // The user's position in this fund and their cash, for the Buy / Sell buttons (DECISIONS.md #19).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      apiFetch<{ latestPlan: { walletBalance: number; holdings: { fundId: string; value: number; costBasis: number }[] } | null }>("/dashboard/summary")
        .then((s) => {
          if (cancelled || !s.latestPlan) return;
          const h = s.latestPlan.holdings.find((x) => x.fundId === fundId);
          setPosition({ cash: s.latestPlan.walletBalance, held: h ? { value: h.value, costBasis: h.costBasis } : null });
        })
        .catch(() => {
          /* the trade buttons just stay hidden */
        });
      return () => {
        cancelled = true;
      };
    }, [fundId])
  );

  const points = useMemo(() => (data ? data.series.map((p) => ({ label: p.month, value: p.growth })) : []), [data]);

  // First load: nothing to show yet. Later range changes keep the old content on screen while loading.
  if (!data && loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "Couldn't load this fund."}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { fund, stats } = data;
  const end = points[points.length - 1];
  const reading = active !== null ? points[active] : end;
  const readingChange = reading.value - 100;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.ticker}>{fund.ticker}</Text>
        <Text style={styles.fundName}>{fund.name}</Text>
        <Text style={styles.meta}>
          {ASSET_CLASS_LABELS[fund.assetClass] ?? fund.assetClass} · {fund.exchange} · {fund.currency}
        </Text>
        <Text style={styles.meta}>
          Latest price S${data.latestPrice.toFixed(2)}
          {fund.currency !== "SGD" ? ` (${fund.currency} ${data.latestPriceLocal.toFixed(2)})` : ""} · history from {longMonth(fund.earliestMonth)} ({fund.monthsAvailable} months)
        </Text>
      </View>

      {position && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Your position</Text>
          {position.held ? (
            <Text style={styles.sub}>
              You hold ${position.held.value.toFixed(2)} of {fund.ticker}, {position.held.value - position.held.costBasis >= 0 ? "up" : "down"} $
              {Math.abs(position.held.value - position.held.costBasis).toFixed(2)} on what you paid.
            </Text>
          ) : (
            <Text style={styles.sub}>You don't hold {fund.ticker}.</Text>
          )}
          <Text style={styles.sub}>Cash available: ${position.cash.toFixed(2)}</Text>
          <View style={styles.tradeRow}>
            <Pressable
              style={styles.buyButton}
              onPress={() => navigation.navigate("Trade", { mode: "buy", name: fund.ticker, fundId: fund.id })}
              accessibilityRole="button"
              accessibilityLabel={`Buy ${fund.ticker}`}
            >
              <Text style={styles.buyText}>Buy</Text>
            </Pressable>
            {position.held && (
              <Pressable
                style={styles.sellButton}
                onPress={() => navigation.navigate("Trade", { mode: "sell", name: fund.ticker, fundId: fund.id })}
                accessibilityRole="button"
                accessibilityLabel={`Sell ${fund.ticker}`}
              >
                <Text style={styles.sellText}>Sell</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <View style={styles.rangeRow}>
        {data.availableRanges.map((r) => (
          <Pressable key={r} style={[styles.chip, data.range === r && styles.chipSelected]} onPress={() => setRange(r)} accessibilityRole="button">
            <Text style={[styles.chipText, data.range === r && styles.chipTextSelected]}>{RANGE_LABELS[r]}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.card, loading && styles.dim]}>
        <Text style={styles.cardHeading}>Growth of 100</Text>
        <Text style={styles.sub}>
          What S$100 invested at the start would be worth, dividends reinvested. Drag across the chart to read it.
        </Text>

        <View style={styles.readout}>
          <Text style={styles.readoutValue}>{reading.value.toFixed(1)}</Text>
          <Text style={[styles.readoutChange, { color: readingChange >= 0 ? GAIN : LOSS }]}>{signed(readingChange)}%</Text>
          <Text style={styles.readoutWhen}>{active !== null ? longMonth(reading.label) : `${longMonth(data.startMonth)} – ${longMonth(data.endMonth)}`}</Text>
        </View>

        <LineChart points={points} activeIndex={active} onActiveChange={setActive} baseline={100} axisFormat={(v) => v.toFixed(0)} />
      </View>

      <View style={[styles.card, loading && styles.dim]}>
        <Text style={styles.cardHeading}>Key figures · {data.months} months</Text>
        <View style={styles.grid}>
          <Stat label="Total return" value={`${signed(stats.totalReturnPct)}%`} tone={stats.totalReturnPct} hint="Over the whole range" />
          <Stat
            label="Per year"
            value={stats.annualizedReturnPct === null ? "—" : `${signed(stats.annualizedReturnPct)}%`}
            tone={stats.annualizedReturnPct}
            hint={stats.annualizedReturnPct === null ? "Needs 12+ months" : "Annualised"}
          />
          <Stat
            label="Ups and downs"
            value={stats.volatilityPct === null ? "—" : `${stats.volatilityPct.toFixed(1)}%`}
            hint={stats.volatilityPct === null ? "Needs 12+ months" : "Volatility: bigger = bumpier"}
          />
          <Stat label="Worst fall" value={`${stats.maxDrawdownPct.toFixed(1)}%`} tone={stats.maxDrawdownPct} hint="Biggest drop from a high" />
          <Stat label="Best month" value={`${signed(stats.bestMonth.returnPct)}%`} tone={stats.bestMonth.returnPct} hint={longMonth(stats.bestMonth.month)} />
          <Stat label="Worst month" value={`${signed(stats.worstMonth.returnPct)}%`} tone={stats.worstMonth.returnPct} hint={longMonth(stats.worstMonth.month)} />
          <Stat label="Up months" value={`${stats.positiveMonthsPct.toFixed(0)}%`} hint="Months that gained" />
          <Stat
            label="Dividend yield"
            value={data.trailingYieldPct === null ? "—" : `${data.trailingYieldPct.toFixed(1)}%`}
            hint={data.trailingYieldPct === null ? "Needs 12+ months" : "Last 12 months"}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Month by month</Text>
        <Text style={styles.sub}>Each bar is one month's return, last {data.recentMonths.length} months.</Text>
        <ReturnBars points={data.recentMonths.map((m) => ({ label: m.month, value: m.returnPct }))} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Year by year</Text>
        {data.calendarYears.map((y) => (
          <View key={y.year} style={styles.yearRow}>
            <Text style={styles.year}>
              {y.year}
              {y.partial ? " (part year)" : ""}
            </Text>
            <Text style={[styles.yearValue, { color: y.returnPct >= 0 ? GAIN : LOSS }]}>{signed(y.returnPct)}%</Text>
          </View>
        ))}
      </View>

      <Text style={styles.disclaimer}>
        Past performance doesn't predict future results. Figures are monthly, include dividends, and are in Singapore dollars{fund.currency !== "SGD" ? `: this ${fund.currency} fund is converted at each month-end exchange rate, so its returns include moves in the exchange rate` : ""}.
        Prices are from Yahoo Finance. This is information, not advice.
      </Text>
    </ScrollView>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: number | null }) {
  const color = tone === undefined || tone === null || tone === 0 ? "#222" : tone > 0 ? GAIN : LOSS;
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

const LONG_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2019-03" -> "Mar 2019" */
function longMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${LONG_MONTHS[Number(m) - 1]} ${y}`;
}

function signed(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "This fund's history isn't available.";
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load this fund. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  tradeRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  buyButton: { flex: 1, backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buyText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  sellButton: { flex: 1, borderWidth: 1, borderColor: "#c0392b", borderRadius: 8, paddingVertical: 12, alignItems: "center", backgroundColor: "#fff" },
  sellText: { color: "#c0392b", fontWeight: "700", fontSize: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  container: { alignItems: "center", padding: 24, gap: 12 },
  error: { color: "#c0392b", textAlign: "center" },
  link: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", paddingVertical: 6 },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 8 },
  dim: { opacity: 0.55 },
  ticker: { fontSize: 22, fontWeight: "700" },
  fundName: { fontSize: 15, color: "#333" },
  meta: { fontSize: 12, color: "#777" },
  rangeRow: { flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  chipSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#2e6fdb", fontWeight: "700" },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  sub: { fontSize: 12, color: "#777" },
  readout: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  readoutValue: { fontSize: 26, fontWeight: "700" },
  readoutChange: { fontSize: 15, fontWeight: "700" },
  readoutWhen: { fontSize: 12, color: "#777" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stat: { width: "47%", gap: 2 },
  statLabel: { fontSize: 12, color: "#555", fontWeight: "600" },
  statValue: { fontSize: 18, fontWeight: "700" },
  statHint: { fontSize: 11, color: "#999" },
  yearRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  year: { color: "#333" },
  yearValue: { fontWeight: "700" },
  disclaimer: { fontSize: 11, color: "#888", textAlign: "center", maxWidth: 360 },
});
