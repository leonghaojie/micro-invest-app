/**
 * S-03 Simulation Setup — UC-03. Select a portfolio (a preset, or a
 * custom multi-fund mix the user builds) + plan parameters, run the
 * deterministic simulation (FR05/06/07, simulation.service.ts), then
 * continue to S-04 Dashboard.
 *
 * DECISIONS.md #1 second amendment: this replaces the old fixed single-
 * fund "portfolio template" picker (SRS UC-03 step 2-3, "System displays
 * portfolio templates. User selects a template.") with a three-step flow:
 * choose an existing portfolio (presets or the user's own) → optionally
 * build a new one from the fund catalog → configure & run.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SimulationSetup">;

type Frequency = "WEEKLY" | "MONTHLY";
type Step = "choose" | "build" | "configure";

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

interface PortfolioAllocationSummary {
  fundId: string;
  ticker: string;
  fundName: string;
  weightPct: number;
}

interface PortfolioSummary {
  id: string;
  name: string;
  isPreset: boolean;
  riskLevel: string | null;
  allocations: PortfolioAllocationSummary[];
}

interface RunSimulationResult {
  simulationId: string;
  finalValue: number;
  totalContributed: number;
  growth: number;
  // DECISIONS.md #1 amendment: true when this plan's duration outlasted
  // the real historical-return series for any fund in the portfolio, so
  // that fund's history was replayed from its start to fill the
  // remaining periods.
  historyWrapped: boolean;
}

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const WEIGHT_SUM_TOLERANCE = 0.01;

export function SimulationSetupScreen({ navigation }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);

  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [weightsByFundId, setWeightsByFundId] = useState<Record<string, string>>({});
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildSubmitting, setBuildSubmitting] = useState(false);

  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [contributionAmount, setContributionAmount] = useState("");
  const [durationMonths, setDurationMonths] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunSimulationResult | null>(null);

  const loadPortfolios = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([apiFetch<PortfolioSummary[]>("/portfolio/portfolios"), apiFetch<FundSummary[]>("/portfolio/funds")])
      .then(([portfolioData, fundData]) => {
        if (cancelled) return;
        setPortfolios(portfolioData);
        setFunds(fundData);
        if (portfolioData.length > 0 && !selectedPortfolioId) setSelectedPortfolioId(portfolioData[0].id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => loadPortfolios(), [loadPortfolios]);

  function toggleFund(fundId: string) {
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
      setPortfolios((prev) => [...prev, created]);
      setSelectedPortfolioId(created.id);
      setWeightsByFundId({});
      setNewPortfolioName("");
      setStep("choose");
    } catch (err) {
      setBuildError(describeError(err));
    } finally {
      setBuildSubmitting(false);
    }
  }

  function validateRun(): string | null {
    if (!selectedPortfolioId) return "Select a portfolio.";
    const amount = Number(contributionAmount);
    if (!contributionAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      return "Enter a contribution amount greater than 0.";
    }
    const duration = Number(durationMonths);
    if (!durationMonths.trim() || !Number.isInteger(duration) || duration <= 0) {
      return "Enter a duration in whole months, greater than 0.";
    }
    return null;
  }

  async function handleRun() {
    const validationError = validateRun();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const response = await apiFetch<RunSimulationResult>("/simulation/run", {
        method: "POST",
        body: {
          portfolioId: selectedPortfolioId,
          frequency,
          contributionAmount: Number(contributionAmount),
          durationMonths: Number(durationMonths),
        },
      });
      setResult(response);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (result) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Simulation complete</Text>
        <View style={styles.resultCard}>
          <ResultRow label="Total contributed" value={formatCurrency(result.totalContributed)} />
          <ResultRow label="Growth" value={formatCurrency(result.growth)} />
          <ResultRow label="Final value" value={formatCurrency(result.finalValue)} emphasized />
        </View>
        {result.historyWrapped && (
          <Text style={styles.historyNote}>
            This plan runs longer than the real historical data available for one or more funds in this portfolio, so
            that history was replayed from the start to fill the remaining years.
          </Text>
        )}
        <Pressable style={styles.submitButton} onPress={() => navigation.replace("Dashboard")}>
          <Text style={styles.submitButtonText}>Continue to Dashboard</Text>
        </Pressable>
      </View>
    );
  }

  const selectedPortfolio = portfolios.find((p) => p.id === selectedPortfolioId) ?? null;

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Set up your simulation</Text>
      <Text style={styles.subtitle}>
        {step === "build" ? "Build a custom portfolio from real funds." : "Pick a portfolio and a contribution plan."}
      </Text>

      {loadError && <Text style={styles.error}>{loadError}</Text>}

      {step === "choose" && !loadError && (
        <View style={styles.form}>
          <Text style={styles.label}>Portfolio</Text>
          {portfolios.length === 0 && <Text style={styles.error}>No portfolios available yet.</Text>}
          <View style={styles.optionColumn}>
            {portfolios.map((portfolio) => (
              <Pressable
                key={portfolio.id}
                style={[styles.templateCard, selectedPortfolioId === portfolio.id && styles.optionButtonSelected]}
                onPress={() => setSelectedPortfolioId(portfolio.id)}
              >
                <Text
                  style={[styles.optionButtonText, selectedPortfolioId === portfolio.id && styles.optionButtonTextSelected]}
                >
                  {portfolio.name}
                  {portfolio.isPreset ? "" : " (custom)"}
                </Text>
                <Text style={styles.templateMeta}>
                  {portfolio.allocations.map((a) => `${a.ticker} ${a.weightPct}%`).join(" · ")}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.secondaryButton} onPress={() => setStep("build")}>
            <Text style={styles.secondaryButtonText}>+ Build your own portfolio</Text>
          </Pressable>

          {selectedPortfolio && (
            <>
              <Text style={styles.label}>Contribution frequency</Text>
              <View style={styles.optionRow}>
                {FREQUENCY_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.optionButton, frequency === option.value && styles.optionButtonSelected]}
                    onPress={() => setFrequency(option.value)}
                    disabled={submitting}
                  >
                    <Text style={[styles.optionButtonText, frequency === option.value && styles.optionButtonTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Contribution amount (per period)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 20"
                keyboardType="numeric"
                value={contributionAmount}
                onChangeText={setContributionAmount}
                editable={!submitting}
              />

              <Text style={styles.label}>Duration (months)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 12"
                keyboardType="numeric"
                value={durationMonths}
                onChangeText={setDurationMonths}
                editable={!submitting}
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                onPress={handleRun}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Run simulation</Text>}
              </Pressable>
            </>
          )}
        </View>
      )}

      {step === "build" && (
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
                <View key={fund.id} style={[styles.templateCard, isSelected && styles.optionButtonSelected]}>
                  <Pressable onPress={() => toggleFund(fund.id)} disabled={buildSubmitting}>
                    <Text style={[styles.optionButtonText, isSelected && styles.optionButtonTextSelected]}>
                      {fund.ticker} — {fund.name}
                    </Text>
                    <Text style={styles.templateMeta}>
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
            <Text style={[styles.templateMeta, Math.abs(weightTotal - 100) > WEIGHT_SUM_TOLERANCE && styles.error]}>
              Total: {round2(weightTotal)}% {Math.abs(weightTotal - 100) > WEIGHT_SUM_TOLERANCE ? "(must equal 100%)" : "✓"}
            </Text>
          )}

          {buildError && <Text style={styles.error}>{buildError}</Text>}

          <Pressable
            style={[styles.submitButton, buildSubmitting && styles.submitButtonDisabled]}
            onPress={handleBuildPortfolio}
            disabled={buildSubmitting}
          >
            {buildSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Save portfolio</Text>}
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => setStep("choose")} disabled={buildSubmitting}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function ResultRow({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={[styles.resultValue, emphasized && styles.resultValueEmphasized]}>{value}</Text>
    </View>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  optionRow: { flexDirection: "row", gap: 8 },
  optionColumn: { gap: 8 },
  optionButton: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    flex: 1,
  },
  templateCard: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  templateMeta: { fontSize: 12, color: "#777", marginTop: 2 },
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
  historyNote: {
    fontSize: 12,
    color: "#777",
    textAlign: "center",
    width: "100%",
    maxWidth: 360,
    marginTop: -4,
  },
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
  resultCard: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 16,
    gap: 8,
    marginTop: 8,
  },
  resultRow: { flexDirection: "row", justifyContent: "space-between" },
  resultLabel: { color: "#555" },
  resultValue: { fontWeight: "600" },
  resultValueEmphasized: { fontSize: 18, color: "#2e6fdb" },
});
