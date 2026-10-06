/**
 * One ready-made portfolio's page (DECISIONS.md #28), opened by tapping it on the Portfolios tab: what
 * it is, what it holds and how it would have done, the way a fund's page does (#14). Three views:
 *  - Key details: who it suits, the risks, and the history's key figures;
 *  - Composition: the asset-class mix and each fund with its weight (tap a fund for its own page);
 *  - Past returns: growth of 100 over a range, year by year, month by month.
 * Buy and "buy every month" sit at the top, so the page ends in the action, not a list of facts.
 *
 * The history is a backtest: the portfolio's funds blended with the weights restored each month, over the
 * months all its funds have, with no fees and no exchange-rate adjustment. It describes the past, never a
 * forecast, and the screen says so.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { LineChart } from "../components/charts/LineChart";
import { ASSET_CLASS_COLORS, ASSET_CLASS_LABELS, MixBar, MixLegend } from "../components/charts/MixBar";
import { ReturnBars } from "../components/charts/ReturnBars";
import type { RootStackScreenProps } from "../navigation/AppNavigator";
import { formatCurrency } from "../utils/peerFormat";

type Props = RootStackScreenProps<"PortfolioDetail">;

type RangeKey = "1y" | "3y" | "5y" | "10y" | "max";
type Tab = "details" | "composition" | "returns";

interface MonthReturn {
  month: string;
  returnPct: number;
}

interface PortfolioDetail {
  portfolio: {
    id: string;
    name: string;
    isPreset: boolean;
    riskLevel: string | null;
    tagline: string | null;
    highlights: string[] | null;
    suits: string | null;
    riskNote: string | null;
  };
  overall: { annualizedReturnPct: number | null; maxDrawdownPct: number; months: number; startMonth: string; endMonth: string };
  composition: { fundId: string; ticker: string; name: string; assetClass: string; exchange: string; currency: string; weightPct: number; earliestMonth: string | null }[];
  assetMix: { assetClass: string; pct: number }[];
  limitedBy: { ticker: string; earliestMonth: string } | null;
  mixedCurrencies: boolean;
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
}

const RANGE_LABELS: Record<RangeKey, string> = { "1y": "1Y", "3y": "3Y", "5y": "5Y", "10y": "10Y", max: "Max" };
const RISK_LABELS: Record<string, string> = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk" };
const RISK_COLORS: Record<string, string> = { LOW: "#2e8b57", MEDIUM: "#e08a2c", HIGH: "#c0392b" };
const GAIN = "#1e8449";
const LOSS = "#c0392b";
const FUNDS_SHOWN = 8;

export function PortfolioDetailScreen({ route, navigation }: Props) {
  const { portfolioId } = route.params;
  const [tab, setTab] = useState<Tab>("details");
  const [range, setRange] = useState<RangeKey | null>(null); // null: let the server pick its default
  const [data, setData] = useState<PortfolioDetail | null>(null);
  const [cash, setCash] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showAllFunds, setShowAllFunds] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<PortfolioDetail>(`/portfolio/portfolios/${encodeURIComponent(portfolioId)}${range ? `?range=${range}` : ""}`)
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
  }, [portfolioId, range]);

  useFocusEffect(load);

  // The user's cash, for the Buy buttons (it is the same cash the Trade screen checks).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      apiFetch<{ latestPlan: { walletBalance: number } | null }>("/dashboard/summary")
        .then((s) => {
          if (!cancelled) setCash(s.latestPlan?.walletBalance ?? null);
        })
        .catch(() => {
          /* the cash line just stays hidden */
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const points = useMemo(() => (data ? data.series.map((p) => ({ label: p.month, value: p.growth })) : []), [data]);

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
        <Text style={styles.error}>{error ?? "Couldn't load this portfolio."}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { portfolio, stats } = data;
  const riskColor = RISK_COLORS[portfolio.riskLevel ?? ""] ?? "#777";
  const name = portfolio.isPreset ? portfolio.name : `${portfolio.name} (yours)`;
  const end = points[points.length - 1];
  const reading = active !== null ? points[active] : end;
  const funds = showAllFunds ? data.composition : data.composition.slice(0, FUNDS_SHOWN);

  function buy(monthly: boolean) {
    navigation.navigate("Trade", { mode: "buy", name: portfolio.name, portfolioId: portfolio.id, ...(monthly ? { monthly: true } : {}) });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{name}</Text>
          {portfolio.riskLevel && (
            <View style={[styles.pill, { borderColor: riskColor }]}>
              <Text style={[styles.pillText, { color: riskColor }]}>{RISK_LABELS[portfolio.riskLevel] ?? portfolio.riskLevel}</Text>
            </View>
          )}
        </View>
        {portfolio.tagline && <Text style={styles.tagline}>{portfolio.tagline}</Text>}
        {portfolio.highlights?.map((h) => (
          <Text key={h} style={styles.bullet}>
            ▸ {h}
          </Text>
        ))}

        <View style={styles.kpiRow}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Past return a year</Text>
            <Text style={[styles.kpiValue, { color: data.overall.annualizedReturnPct === null ? "#222" : data.overall.annualizedReturnPct >= 0 ? GAIN : LOSS }]}>
              {data.overall.annualizedReturnPct === null ? "—" : `${signed(data.overall.annualizedReturnPct)}%`}
            </Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Worst fall</Text>
            <Text style={[styles.kpiValue, { color: LOSS }]}>{data.overall.maxDrawdownPct.toFixed(1)}%</Text>
          </View>
        </View>
        <Text style={styles.sub}>
          Whole history: {data.overall.months} months, {longMonth(data.overall.startMonth)} to {longMonth(data.overall.endMonth)}.
        </Text>

        {cash !== null && <Text style={styles.sub}>Cash available: {formatCurrency(cash)}</Text>}
        <Pressable style={styles.buyButton} onPress={() => buy(false)} accessibilityRole="button" accessibilityLabel={`Buy ${portfolio.name}`}>
          <Text style={styles.buyText}>Buy</Text>
        </Pressable>
        <Pressable onPress={() => buy(true)} accessibilityRole="button" accessibilityLabel={`Buy ${portfolio.name} every month`}>
          <Text style={styles.link}>Or buy it every month</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["details", "Key details"],
            ["composition", "Composition"],
            ["returns", "Past returns"],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} style={[styles.tab, tab === key && styles.tabSelected]} onPress={() => setTab(key)} accessibilityRole="button" accessibilityState={{ selected: tab === key }}>
            <Text style={[styles.tabText, tab === key && styles.tabTextSelected]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "details" && (
        <>
          {portfolio.suits && (
            <View style={styles.card}>
              <Text style={styles.cardHeading}>Who it suits</Text>
              <Text style={styles.body}>{portfolio.suits}</Text>
            </View>
          )}
          {portfolio.riskNote && (
            <View style={styles.card}>
              <Text style={styles.cardHeading}>Risk considerations</Text>
              <Text style={styles.body}>{portfolio.riskNote}</Text>
              <View style={styles.lossRow}>
                <Text style={styles.body}>Worst fall so far</Text>
                <Text style={[styles.lossValue, { color: LOSS }]}>{data.overall.maxDrawdownPct.toFixed(1)}%</Text>
              </View>
              <Text style={styles.sub}>The drop from the highest point to the lowest that followed, over the whole {data.overall.months} months of history, worked out from past prices.</Text>
            </View>
          )}
          <View style={styles.card}>
            <Text style={styles.cardHeading}>Key figures · {data.months} months</Text>
            <View style={styles.grid}>
              <Stat label="Total return" value={`${signed(stats.totalReturnPct)}%`} tone={stats.totalReturnPct} hint="Over the whole period" />
              <Stat
                label="Per year"
                value={stats.annualizedReturnPct === null ? "—" : `${signed(stats.annualizedReturnPct)}%`}
                tone={stats.annualizedReturnPct}
                hint={stats.annualizedReturnPct === null ? "Needs 12+ months" : "Annualised"}
              />
              <Stat label="Ups and downs" value={stats.volatilityPct === null ? "—" : `${stats.volatilityPct.toFixed(1)}%`} hint={stats.volatilityPct === null ? "Needs 12+ months" : "Volatility: bigger = bumpier"} />
              <Stat label="Worst fall" value={`${stats.maxDrawdownPct.toFixed(1)}%`} tone={stats.maxDrawdownPct} hint="Biggest drop from a high" />
              <Stat label="Best month" value={`${signed(stats.bestMonth.returnPct)}%`} tone={stats.bestMonth.returnPct} hint={longMonth(stats.bestMonth.month)} />
              <Stat label="Worst month" value={`${signed(stats.worstMonth.returnPct)}%`} tone={stats.worstMonth.returnPct} hint={longMonth(stats.worstMonth.month)} />
            </View>
          </View>
        </>
      )}

      {tab === "composition" && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>What it holds</Text>
          <MixBar entries={data.assetMix} />
          <MixLegend classes={data.assetMix.map((m) => m.assetClass)} />
          <View style={styles.tableHead}>
            <Text style={styles.tableHeadText}>FUNDS</Text>
            <Text style={styles.tableHeadText}>ALLOCATION</Text>
          </View>
          {funds.map((f) => (
            <Pressable
              key={f.fundId}
              style={styles.fundRow}
              onPress={() => navigation.navigate("FundDetail", { fundId: f.fundId, ticker: f.ticker })}
              accessibilityRole="button"
              accessibilityLabel={`${f.ticker}: open the fund`}
            >
              <View style={styles.fundTop}>
                <View style={styles.fundName}>
                  <Text style={styles.ticker}>{f.ticker}</Text>
                  <Text style={styles.fundFull} numberOfLines={1}>
                    {f.name}
                  </Text>
                </View>
                <Text style={styles.weight}>{formatPct(f.weightPct)}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(Math.max(f.weightPct, 0), 100)}%`, backgroundColor: ASSET_CLASS_COLORS[f.assetClass] ?? "#999" }]} />
              </View>
              <Text style={styles.sub}>
                {ASSET_CLASS_LABELS[f.assetClass] ?? f.assetClass} · {f.exchange} · {f.currency} ›
              </Text>
            </Pressable>
          ))}
          {data.composition.length > FUNDS_SHOWN && (
            <Pressable onPress={() => setShowAllFunds((v) => !v)}>
              <Text style={styles.link}>{showAllFunds ? `Show the top ${FUNDS_SHOWN}` : `Show all ${data.composition.length} funds`}</Text>
            </Pressable>
          )}
          <Text style={styles.sub}>Weights are each fund's share of what you buy. Buying a portfolio splits your amount across its funds by these weights; after that the funds move on their own.</Text>
        </View>
      )}

      {tab === "returns" && (
        <>
          <View style={styles.rangeRow}>
            {data.availableRanges.map((r) => (
              <Pressable key={r} style={[styles.chip, data.range === r && styles.chipSelected]} onPress={() => setRange(r)} accessibilityRole="button">
                <Text style={[styles.chipText, data.range === r && styles.chipTextSelected]}>{RANGE_LABELS[r]}</Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.card, loading && styles.dim]}>
            <Text style={styles.cardHeading}>Growth of 100</Text>
            <Text style={styles.sub}>What 100 put in at the start would be worth, with the mix kept at its weights each month. Drag across the chart to read it.</Text>
            <View style={styles.readout}>
              <Text style={styles.readoutValue}>{reading.value.toFixed(1)}</Text>
              <Text style={[styles.readoutChange, { color: reading.value - 100 >= 0 ? GAIN : LOSS }]}>{signed(reading.value - 100)}%</Text>
              <Text style={styles.sub}>{active !== null ? longMonth(reading.label) : `${longMonth(data.startMonth)} – ${longMonth(data.endMonth)}`}</Text>
            </View>
            <LineChart points={points} activeIndex={active} onActiveChange={setActive} baseline={100} axisFormat={(v) => v.toFixed(0)} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardHeading}>Year by year</Text>
            {data.calendarYears.map((y) => (
              <View key={y.year} style={styles.yearRow}>
                <Text style={styles.body}>
                  {y.year}
                  {y.partial ? " (part year)" : ""}
                </Text>
                <Text style={[styles.yearValue, { color: y.returnPct >= 0 ? GAIN : LOSS }]}>{signed(y.returnPct)}%</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardHeading}>Month by month</Text>
            <Text style={styles.sub}>Each bar is one month's return, last {data.recentMonths.length} months.</Text>
            <ReturnBars points={data.recentMonths.map((m) => ({ label: m.month, value: m.returnPct }))} />
          </View>
        </>
      )}

      {data.limitedBy && (
        <Text style={styles.disclaimer}>
          The whole history starts in {longMonth(data.limitedBy.earliestMonth)} because {data.limitedBy.ticker} has no earlier data; the other funds go back further.
        </Text>
      )}
      <Text style={styles.disclaimer}>
        Past performance doesn't predict future results. These figures are a backtest: the funds' monthly returns, dividends included, blended at the weights above and restored each month, with no fees
        {data.mixedCurrencies ? " and no conversion between the funds' currencies (some are in US dollars, some in Singapore dollars)" : ""}. This is information, not advice.
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2019-03" -> "Mar 2019" */
function longMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function signed(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function formatPct(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "This portfolio isn't available.";
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't load this portfolio. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  container: { alignItems: "center", padding: 24, gap: 12 },
  error: { color: "#c0392b", textAlign: "center" },
  link: { color: "#2e6fdb", fontWeight: "600", textAlign: "center", paddingVertical: 6 },
  card: { width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 16, gap: 8 },
  dim: { opacity: 0.55 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 22, fontWeight: "700" },
  pill: { borderWidth: 1, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10 },
  pillText: { fontSize: 12, fontWeight: "700" },
  tagline: { fontSize: 15, color: "#333" },
  bullet: { fontSize: 14, color: "#444" },
  kpiRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  kpi: { flex: 1, backgroundColor: "#f6f8fc", borderRadius: 8, padding: 10, gap: 2 },
  kpiLabel: { fontSize: 11, color: "#666", fontWeight: "600" },
  kpiValue: { fontSize: 20, fontWeight: "700" },
  sub: { fontSize: 12, color: "#777" },
  body: { fontSize: 14, color: "#444" },
  buyButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  buyText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  tabs: { flexDirection: "row", width: "100%", maxWidth: 360, borderBottomWidth: 1, borderBottomColor: "#ddd" },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabSelected: { borderBottomColor: "#2e6fdb" },
  tabText: { fontSize: 13, fontWeight: "700", color: "#666" },
  tabTextSelected: { color: "#2e6fdb" },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  lossRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 },
  lossValue: { fontSize: 18, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stat: { width: "47%", gap: 2 },
  statLabel: { fontSize: 12, color: "#555", fontWeight: "600" },
  statValue: { fontSize: 18, fontWeight: "700" },
  statHint: { fontSize: 11, color: "#999" },
  tableHead: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#eef1f6", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10, marginTop: 4 },
  tableHeadText: { fontSize: 11, fontWeight: "700", color: "#667" },
  fundRow: { gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  fundTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  fundName: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  ticker: { fontWeight: "700", color: "#222" },
  fundFull: { flex: 1, fontSize: 12, color: "#666" },
  weight: { fontWeight: "700", color: "#222" },
  track: { height: 6, borderRadius: 3, backgroundColor: "#eee", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  rangeRow: { flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  chipSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#2e6fdb", fontWeight: "700" },
  readout: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  readoutValue: { fontSize: 26, fontWeight: "700" },
  readoutChange: { fontSize: 15, fontWeight: "700" },
  yearRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  yearValue: { fontWeight: "700" },
  disclaimer: { fontSize: 11, color: "#888", textAlign: "center", maxWidth: 360 },
});
