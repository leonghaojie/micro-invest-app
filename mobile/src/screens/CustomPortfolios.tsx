/**
 * Custom — the "Custom" view of the Invest tab (DECISIONS.md #30): your own mixes of funds. It used to be
 * a form at the top of the Funds list, where picked funds and their weights sat among a long list of
 * funds; now the funds you have picked and their weights are one short list of their own, with the
 * catalog to pick from beneath it.
 *
 *  - Your mixes: the portfolios you saved, each opening its page (key details, composition, past
 *    returns) where it can be bought once or every month;
 *  - Create a mix: a name, the funds you add (search and filter the catalog below), a weight for
 *    each that must add up to 100% (or split them evenly), and Save (POST /portfolio/portfolios).
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch } from "../api/client";
import { ASSET_CLASS_LABELS, MixBar } from "../components/charts/MixBar";
import { FundFilters } from "../components/FundFilters";
import { KeyboardScreen } from "../components/KeyboardScreen";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { describeError, FundSummary, useFundCatalog, useFundFilter } from "../utils/fundCatalog";

interface PortfolioSummary {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  history: { annualizedReturnPct: number | null; maxDrawdownPct: number; months: number } | null;
  allocations: { fundId: string; ticker: string; fundName: string; assetClass: string; weightPct: number }[];
}

const WEIGHT_SUM_TOLERANCE = 0.01;

export function CustomPortfolios() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { funds, loading, error, reload } = useFundCatalog();
  const filter = useFundFilter(funds);

  const [mixes, setMixes] = useState<PortfolioSummary[]>([]);
  const [name, setName] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [buildError, setBuildError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);

  const loadMixes = useCallback(() => {
    let cancelled = false;
    apiFetch<PortfolioSummary[]>("/portfolio/portfolios")
      .then((all) => {
        if (!cancelled) setMixes(all.filter((p) => !p.isPreset));
      })
      .catch(() => {
        /* the list just stays as it was */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(loadMixes);

  const picked = funds.filter((f) => f.id in weights);
  const total = picked.reduce((sum, f) => sum + (Number(weights[f.id]) || 0), 0);
  const totalOk = Math.abs(total - 100) <= WEIGHT_SUM_TOLERANCE;

  function toggle(fund: FundSummary) {
    setSaved(null);
    setBuildError(null);
    setWeights((prev) => {
      const next = { ...prev };
      if (fund.id in next) delete next[fund.id];
      else next[fund.id] = "";
      return next;
    });
  }

  function setWeight(fundId: string, value: string) {
    setSaved(null);
    setWeights((prev) => ({ ...prev, [fundId]: value }));
  }

  /** 100 split evenly, to two decimals, the last fund taking the rounding so the total is exactly 100. */
  function splitEvenly() {
    if (picked.length === 0) return;
    const each = Math.floor((100 / picked.length) * 100) / 100;
    const next: Record<string, string> = {};
    picked.forEach((f, i) => {
      next[f.id] = String(i === picked.length - 1 ? round2(100 - each * (picked.length - 1)) : each);
    });
    setSaved(null);
    setWeights(next);
  }

  async function save() {
    if (!name.trim()) return setBuildError("Give your mix a name.");
    if (picked.length === 0) return setBuildError("Add at least one fund.");
    if (!totalOk) return setBuildError(`Weights must add up to 100% (currently ${round2(total)}%).`);

    setBuildError(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<PortfolioSummary>("/portfolio/portfolios", {
        method: "POST",
        body: { name: name.trim(), allocations: picked.map((f) => ({ fundId: f.id, weightPct: Number(weights[f.id]) })) },
      });
      setSaved({ id: created.id, name: created.name });
      setWeights({});
      setName("");
      loadMixes();
    } catch (err) {
      setBuildError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && funds.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error && funds.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.secondaryButton} onPress={reload}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Custom portfolios</Text>
      <Text style={styles.subtitle}>Build your own mix: pick funds and decide how much of each. Buying it splits your amount across them by weight.</Text>

      {mixes.length > 0 && (
        <View style={styles.column}>
          <Text style={styles.heading}>Your mixes</Text>
          {mixes.map((p) => (
            <Pressable
              key={p.id}
              style={styles.mixCard}
              onPress={() => navigation.navigate("PortfolioDetail", { portfolioId: p.id, name: p.name })}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}: see details`}
            >
              <View style={styles.mixTop}>
                <Text style={styles.mixName}>{p.name}</Text>
                <Text style={styles.chevron}>›</Text>
              </View>
              <MixBar entries={mixOf(p)} />
              <Text style={styles.meta}>{p.allocations.map((a) => `${a.ticker} ${a.weightPct}%`).join(" · ")}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.column}>
        <Text style={styles.heading}>Create a mix</Text>
        <TextInput style={styles.input} placeholder="Name, e.g. My global mix" value={name} onChangeText={setName} editable={!submitting} />

        <Text style={styles.label}>Your funds ({picked.length})</Text>
        {picked.length === 0 && <Text style={styles.meta}>No funds yet. Add some from the list below.</Text>}
        {picked.map((f) => (
          <View key={f.id} style={styles.pickedRow}>
            <View style={styles.pickedName}>
              <Text style={styles.ticker}>{f.ticker}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {f.name}
              </Text>
            </View>
            <TextInput
              style={styles.weightInput}
              placeholder="%"
              keyboardType="numeric"
              value={weights[f.id]}
              onChangeText={(v) => setWeight(f.id, v)}
              editable={!submitting}
              accessibilityLabel={`${f.ticker} weight`}
            />
            <Pressable onPress={() => toggle(f)} accessibilityRole="button" accessibilityLabel={`Remove ${f.ticker}`} hitSlop={8}>
              <Text style={styles.remove}>✕</Text>
            </Pressable>
          </View>
        ))}

        {picked.length > 0 && (
          <View style={styles.totalRow}>
            <Text style={[styles.total, !totalOk && styles.error]}>
              Total: {round2(total)}% {totalOk ? "✓" : "(must equal 100%)"}
            </Text>
            <Pressable onPress={splitEvenly} accessibilityRole="button">
              <Text style={styles.link}>Split evenly</Text>
            </Pressable>
          </View>
        )}

        {buildError && <Text style={styles.error}>{buildError}</Text>}

        {saved && (
          <View style={styles.savedBanner}>
            <Text style={styles.savedText}>“{saved.name}” saved.</Text>
            <Pressable onPress={() => navigation.navigate("PortfolioDetail", { portfolioId: saved.id, name: saved.name })}>
              <Text style={styles.link}>See it, and buy it →</Text>
            </Pressable>
          </View>
        )}

        <Pressable style={[styles.submitButton, submitting && styles.disabled]} onPress={save} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save mix</Text>}
        </Pressable>
      </View>

      <View style={styles.column}>
        <Text style={styles.heading}>Add funds</Text>
        <FundFilters filter={filter} total={funds.length} note={picked.length > 0 && filter.visible.length < funds.length ? " · picked funds stay picked when filtered out" : ""} />
        {filter.visible.map((fund) => {
          const isPicked = fund.id in weights;
          return (
            <View key={fund.id} style={[styles.fundCard, isPicked && styles.fundCardPicked]}>
              <Pressable
                style={styles.fundMain}
                onPress={() => navigation.navigate("FundDetail", { fundId: fund.id, ticker: fund.ticker })}
                accessibilityRole="button"
                accessibilityLabel={`${fund.ticker} details`}
              >
                <Text style={[styles.fundName, isPicked && styles.fundNamePicked]}>
                  {fund.ticker} — {fund.name}
                </Text>
                <Text style={styles.meta}>
                  {ASSET_CLASS_LABELS[fund.assetClass] ?? fund.assetClass} · {fund.currency} · {fund.latestMonthlyReturn !== null ? `${(fund.latestMonthlyReturn * 100).toFixed(1)}% last month` : "no data yet"}
                </Text>
                <Text style={styles.link}>View history ›</Text>
              </Pressable>
              <Pressable
                style={[styles.addButton, isPicked && styles.addButtonOn]}
                onPress={() => toggle(fund)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={isPicked ? `Remove ${fund.ticker} from the mix` : `Add ${fund.ticker} to the mix`}
              >
                <Text style={[styles.addText, isPicked && styles.addTextOn]}>{isPicked ? "✓" : "+"}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </KeyboardScreen>
  );
}

function mixOf(p: PortfolioSummary): { assetClass: string; pct: number }[] {
  const byClass = new Map<string, number>();
  for (const a of p.allocations) byClass.set(a.assetClass, (byClass.get(a.assetClass) ?? 0) + a.weightPct);
  return [...byClass.entries()].map(([assetClass, pct]) => ({ assetClass, pct })).sort((a, b) => b.pct - a.pct);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  container: { alignItems: "center", padding: 24, gap: 14 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", textAlign: "center", maxWidth: 340 },
  column: { width: "100%", maxWidth: 360, gap: 8 },
  heading: { fontSize: 18, fontWeight: "700" },
  label: { fontSize: 14, fontWeight: "600", marginTop: 6 },
  meta: { fontSize: 12, color: "#777" },
  error: { color: "#c0392b" },
  link: { color: "#2e6fdb", fontWeight: "600", fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: "#fff" },
  mixCard: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, gap: 6 },
  mixTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mixName: { flex: 1, fontSize: 16, fontWeight: "600" },
  chevron: { fontSize: 22, color: "#999" },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#2e6fdb", backgroundColor: "#eaf1fd", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  pickedName: { flex: 1 },
  ticker: { fontWeight: "700", color: "#222" },
  weightInput: { width: 70, borderWidth: 1, borderColor: "#ccc", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, backgroundColor: "#fff", textAlign: "right" },
  remove: { fontSize: 16, color: "#999", paddingHorizontal: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  total: { fontSize: 13, fontWeight: "600", color: "#333" },
  savedBanner: { borderWidth: 1, borderColor: "#2e8b57", backgroundColor: "#eafaf1", borderRadius: 8, padding: 12, gap: 4, alignItems: "center" },
  savedText: { color: "#2e8b57", fontWeight: "600" },
  submitButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  disabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fundCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  fundCardPicked: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  fundMain: { flex: 1, gap: 2 },
  fundName: { color: "#333" },
  fundNamePicked: { color: "#2e6fdb", fontWeight: "600" },
  addButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: "#2e6fdb", alignItems: "center", justifyContent: "center" },
  addButtonOn: { backgroundColor: "#2e6fdb" },
  addText: { color: "#2e6fdb", fontSize: 22, fontWeight: "600", lineHeight: 24 },
  addTextOn: { color: "#fff", fontSize: 18 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600", textAlign: "center" },
});
