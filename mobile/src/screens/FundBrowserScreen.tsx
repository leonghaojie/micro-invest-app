/**
 * Funds tab — new screen, split out of what used to be S-03's "build a
 * portfolio" step (SimulationSetupScreen) as part of the 20 Aug 2026 UI
 * restructuring (AppNavigator.tsx header). Not its own SRS screen ID —
 * pure UI reorganisation of existing FR04 (browse funds) / portfolio-
 * composition capability (DECISIONS.md #1 second amendment), not new
 * backend scope.
 *
 * Two things at once, same screen: browse the full fund catalog (ticker,
 * asset class, exchange, years of real historical data, latest annual
 * return), and optionally build+save a new custom multi-fund portfolio
 * from it by tapping funds and setting a weight per fund (must sum to
 * 100%, portfolio.service.ts). A saved portfolio then shows up back in
 * the Contribution tab's portfolio picker.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import type { MainTabScreenProps } from "../navigation/AppNavigator";

type Props = MainTabScreenProps<"Funds">;

interface FundSummary {
  id: string;
  ticker: string;
  name: string;
  assetClass: string;
  exchange: string;
  currency: string;
  yearsAvailable: number;
  latestAnnualReturn: number | null;
}

interface PortfolioSummary {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  allocations: { fundId: string; ticker: string; fundName: string; weightPct: number }[];
}

const WEIGHT_SUM_TOLERANCE = 0.01;

export function FundBrowserScreen({ navigation }: Props) {
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [weightsByFundId, setWeightsByFundId] = useState<Record<string, string>>({});
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildSubmitting, setBuildSubmitting] = useState(false);
  const [savedPortfolioName, setSavedPortfolioName] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    apiFetch<FundSummary[]>("/portfolio/funds")
      .then((data) => {
        if (!cancelled) setFunds(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  function toggleFund(fundId: string) {
    setSavedPortfolioName(null);
    setWeightsByFundId((prev) => {
      const next = { ...prev };
      if (fundId in next) {
        delete next[fundId];
      } else {
        next[fundId] = "";
      }
      return next;
    });
  }

  function setWeight(fundId: string, value: string) {
    setSavedPortfolioName(null);
    setWeightsByFundId((prev) => ({ ...prev, [fundId]: value }));
  }

  const selectedFundIds = Object.keys(weightsByFundId);
  const weightTotal = selectedFundIds.reduce((sum, id) => sum + (Number(weightsByFundId[id]) || 0), 0);

  async function handleBuildPortfolio() {
    if (!newPortfolioName.trim()) {
      setBuildError("Give your portfolio a name.");
      return;
    }
    if (selectedFundIds.length === 0) {
      setBuildError("Select at least one fund.");
      return;
    }
    if (Math.abs(weightTotal - 100) > WEIGHT_SUM_TOLERANCE) {
      setBuildError(`Weights must add up to 100% (currently ${round2(weightTotal)}%).`);
      return;
    }

    setBuildError(null);
    setBuildSubmitting(true);
    try {
      const created = await apiFetch<PortfolioSummary>("/portfolio/portfolios", {
        method: "POST",
        body: {
          name: newPortfolioName.trim(),
          allocations: selectedFundIds.map((fundId) => ({ fundId, weightPct: Number(weightsByFundId[fundId]) })),
        },
      });
      setSavedPortfolioName(created.name);
      setWeightsByFundId({});
      setNewPortfolioName("");
    } catch (err) {
      setBuildError(describeError(err));
    } finally {
      setBuildSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{loadError}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Funds</Text>
      <Text style={styles.subtitle}>Browse the fund catalog, or tap funds below to build your own portfolio.</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Portfolio name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. My global mix"
          value={newPortfolioName}
          onChangeText={setNewPortfolioName}
          editable={!buildSubmitting}
        />

        <Text style={styles.label}>Funds ({selectedFundIds.length} selected)</Text>
        <View style={styles.optionColumn}>
          {funds.map((fund) => {
            const isSelected = fund.id in weightsByFundId;
            return (
              <View key={fund.id} style={[styles.fundCard, isSelected && styles.optionButtonSelected]}>
                <Pressable onPress={() => toggleFund(fund.id)} disabled={buildSubmitting}>
                  <Text style={[styles.optionButtonText, isSelected && styles.optionButtonTextSelected]}>
                    {fund.ticker} — {fund.name}
                  </Text>
                  <Text style={styles.fundMeta}>
                    {fund.assetClass} · {fund.exchange} ·{" "}
                    {fund.latestAnnualReturn !== null
                      ? `${(fund.latestAnnualReturn * 100).toFixed(1)}% latest annual return`
                      : "no data yet"}{" "}
                    · {fund.yearsAvailable}y history
                  </Text>
                </Pressable>
                {isSelected && (
                  <TextInput
                    style={styles.weightInput}
                    placeholder="Weight %"
                    keyboardType="numeric"
                    value={weightsByFundId[fund.id]}
                    onChangeText={(v) => setWeight(fund.id, v)}
                    editable={!buildSubmitting}
                  />
                )}
              </View>
            );
          })}
        </View>

        {selectedFundIds.length > 0 && (
          <Text style={[styles.fundMeta, Math.abs(weightTotal - 100) > WEIGHT_SUM_TOLERANCE && styles.error]}>
            Total: {round2(weightTotal)}% {Math.abs(weightTotal - 100) > WEIGHT_SUM_TOLERANCE ? "(must equal 100%)" : "✓"}
          </Text>
        )}

        {buildError && <Text style={styles.error}>{buildError}</Text>}

        {savedPortfolioName && (
          <View style={styles.savedBanner}>
            <Text style={styles.savedBannerText}>“{savedPortfolioName}” saved.</Text>
            <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Contribution")}>
              <Text style={styles.secondaryButtonText}>Set up a contribution with it →</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={[styles.submitButton, buildSubmitting && styles.submitButtonDisabled]}
          onPress={handleBuildPortfolio}
          disabled={buildSubmitting}
        >
          {buildSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Save portfolio</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Something went wrong. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 16, textAlign: "center" },
  form: { width: "100%", maxWidth: 360, gap: 8 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 12 },
  optionColumn: { gap: 8 },
  fundCard: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  fundMeta: { fontSize: 12, color: "#777", marginTop: 2 },
  optionButtonSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  optionButtonText: { color: "#333" },
  optionButtonTextSelected: { color: "#2e6fdb", fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  weightInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  error: { color: "#c0392b", textAlign: "center", marginTop: 8 },
  savedBanner: {
    borderWidth: 1,
    borderColor: "#2e8b57",
    backgroundColor: "#eafaf1",
    borderRadius: 8,
    padding: 12,
    gap: 6,
    alignItems: "center",
  },
  savedBannerText: { color: "#2e8b57", fontWeight: "600" },
  submitButton: {
    backgroundColor: "#2e6fdb",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
    width: "100%",
    maxWidth: 360,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 10, alignItems: "center" },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
});
