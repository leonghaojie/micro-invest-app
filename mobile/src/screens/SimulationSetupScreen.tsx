/**
 * S-03 Configure & Run Simulation — UC-03. User-facing tab label:
 * "Contribution" (AppNavigator.tsx) — pick a portfolio + a contribution
 * plan, run the deterministic simulation (FR05/06/07,
 * simulation.service.ts), see the result.
 *
 * DECISIONS.md #1 second amendment: replaced the old fixed single-fund
 * "portfolio template" picker (SRS UC-03 step 2-3) with a portfolio
 * picker over presets + the user's own multi-fund portfolios.
 *
 * UI restructuring (20 Aug 2026, AppNavigator.tsx): this used to be a
 * 3-step flow with an embedded "build a new portfolio" step. That step
 * moved out to its own Funds tab (FundBrowserScreen) — this screen is
 * now just choose-a-portfolio + configure-and-run, and links out to the
 * Funds tab instead of building inline. Running a simulation switches to
 * the Dashboard tab (sibling, not a stack push) rather than replacing
 * this screen; the portfolio list also now refreshes on every tab focus
 * so a portfolio just built in the Funds tab shows up here without a
 * reload.
 *
 * DECISIONS.md #6: contribution amount comes from one of two mechanisms
 * — Scheduled deposit (direct amount) or Round-up (spare-change inputs,
 * derived server-side; previewed client-side here too).
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import type { MainTabScreenProps } from "../navigation/AppNavigator";

type Props = MainTabScreenProps<"Contribution">;

type Frequency = "WEEKLY" | "MONTHLY";
type Mechanism = "SCHEDULED" | "ROUND_UP";

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
  // DECISIONS.md #6: the actual per-period amount used — for a Round-up
  // run this is what the spare-change inputs derived to.
  contributionAmount: number;
  mechanism: Mechanism;
}

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const MECHANISM_OPTIONS: { value: Mechanism; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled deposit" },
  { value: "ROUND_UP", label: "Round-up" },
];

// Mirrors deriveRoundUpContribution in simulation.service.ts — client-side
// only, for a live preview; the backend recomputes this itself.
function deriveRoundUpPreview(avgTransactionsPerWeek: number, avgRoundUpAmount: number, frequency: Frequency): number {
  const weeksPerPeriod = frequency === "WEEKLY" ? 1 : 52 / 12;
  return round2(avgTransactionsPerWeek * weeksPerPeriod * avgRoundUpAmount);
}

export function SimulationSetupScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);

  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [mechanism, setMechanism] = useState<Mechanism>("SCHEDULED");
  const [contributionAmount, setContributionAmount] = useState("");
  const [avgTransactionsPerWeek, setAvgTransactionsPerWeek] = useState("");
  const [avgRoundUpAmount, setAvgRoundUpAmount] = useState("");
  const [durationMonths, setDurationMonths] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunSimulationResult | null>(null);

  const loadPortfolios = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    apiFetch<PortfolioSummary[]>("/portfolio/portfolios")
      .then((data) => {
        if (cancelled) return;
        setPortfolios(data);
        setSelectedPortfolioId((prev) => prev ?? (data.length > 0 ? data[0].id : null));
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

  useFocusEffect(loadPortfolios);

  function validateRun(): string | null {
    if (!selectedPortfolioId) return "Select a portfolio.";
    if (mechanism === "SCHEDULED") {
      const amount = Number(contributionAmount);
      if (!contributionAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
        return "Enter a contribution amount greater than 0.";
      }
    } else {
      const transactions = Number(avgTransactionsPerWeek);
      if (!avgTransactionsPerWeek.trim() || !Number.isInteger(transactions) || transactions <= 0) {
        return "Enter an average number of transactions per week, greater than 0.";
      }
      const roundUp = Number(avgRoundUpAmount);
      if (!avgRoundUpAmount.trim() || !Number.isFinite(roundUp) || roundUp <= 0) {
        return "Enter an average round-up amount greater than 0.";
      }
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
      const body =
        mechanism === "SCHEDULED"
          ? {
              portfolioId: selectedPortfolioId,
              frequency,
              mechanism,
              contributionAmount: Number(contributionAmount),
              durationMonths: Number(durationMonths),
            }
          : {
              portfolioId: selectedPortfolioId,
              frequency,
              mechanism,
              avgTransactionsPerWeek: Number(avgTransactionsPerWeek),
              avgRoundUpAmount: Number(avgRoundUpAmount),
              durationMonths: Number(durationMonths),
            };
      const response = await apiFetch<RunSimulationResult>("/simulation/run", { method: "POST", body });
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
        {result.mechanism === "ROUND_UP" && (
          <Text style={styles.historyNote}>
            Your round-up inputs derived to {formatCurrency(result.contributionAmount)} per period.
          </Text>
        )}
        {result.historyWrapped && (
          <Text style={styles.historyNote}>
            This plan runs longer than the real historical data available for one or more funds in this portfolio, so
            that history was replayed from the start to fill the remaining years.
          </Text>
        )}
        <Pressable style={styles.submitButton} onPress={() => navigation.navigate("Dashboard")}>
          <Text style={styles.submitButtonText}>View on Dashboard</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => setResult(null)}>
          <Text style={styles.secondaryButtonText}>Edit contribution</Text>
        </Pressable>
      </View>
    );
  }

  const selectedPortfolio = portfolios.find((p) => p.id === selectedPortfolioId) ?? null;

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Your contribution</Text>
      <Text style={styles.subtitle}>Pick a portfolio and a contribution plan.</Text>

      {loadError && <Text style={styles.error}>{loadError}</Text>}

      {!loadError && (
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

          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Funds")}>
            <Text style={styles.secondaryButtonText}>Don't see what you want? Build one in the Funds tab →</Text>
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

              <Text style={styles.label}>Contribution mechanism</Text>
              <View style={styles.optionRow}>
                {MECHANISM_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.optionButton, mechanism === option.value && styles.optionButtonSelected]}
                    onPress={() => setMechanism(option.value)}
                    disabled={submitting}
                  >
                    <Text style={[styles.optionButtonText, mechanism === option.value && styles.optionButtonTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {mechanism === "SCHEDULED" ? (
                <>
                  <Text style={styles.label}>Contribution amount (per period)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 20"
                    keyboardType="numeric"
                    value={contributionAmount}
                    onChangeText={setContributionAmount}
                    editable={!submitting}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.label}>Average transactions per week</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 10"
                    keyboardType="numeric"
                    value={avgTransactionsPerWeek}
                    onChangeText={setAvgTransactionsPerWeek}
                    editable={!submitting}
                  />

                  <Text style={styles.label}>Average round-up per transaction ($)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 0.60"
                    keyboardType="numeric"
                    value={avgRoundUpAmount}
                    onChangeText={setAvgRoundUpAmount}
                    editable={!submitting}
                  />

                  {avgTransactionsPerWeek.trim() !== "" && avgRoundUpAmount.trim() !== "" && (
                    <Text style={styles.templateMeta}>
                      ≈ {formatCurrency(
                        deriveRoundUpPreview(Number(avgTransactionsPerWeek) || 0, Number(avgRoundUpAmount) || 0, frequency)
                      )}{" "}
                      per period
                    </Text>
                  )}
                </>
              )}

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
