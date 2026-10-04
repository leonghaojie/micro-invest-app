/**
 * S-03 Configure & Start Plan — UC-03. User-facing tab label: "Contribution"
 * (AppNavigator.tsx, tab route key kept as "Contribution" to avoid
 * rippling navigation param renames across every screen that navigates
 * here — only the screen/component itself is renamed, per the plan).
 *
 * DECISIONS.md #1 third amendment (25 Aug 2026): replaces frequency +
 * mechanism + duration with a start month — the plan always runs from
 * there through to the real current month using real monthly fund
 * returns (plan.service.ts). Contribution amount is capped client-side by
 * the profile's monthlyIncome (also enforced server-side, 422 otherwise).
 * There's only ever one active plan — starting a new one replaces any
 * existing one (POST /plan deletes-then-creates).
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import type { MainTabScreenProps } from "../navigation/AppNavigator";
import { KeyboardScreen } from "../components/KeyboardScreen";

type Props = MainTabScreenProps<"Contribution">;

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
  /** Earliest month a plan on this portfolio can start ("YYYY-MM"), or null if a fund has no data. */
  earliestStartMonth: string | null;
  allocations: PortfolioAllocationSummary[];
}

interface ProfileResponse {
  monthlyIncome: number;
}

interface PlanResult {
  planId: string;
  portfolioName: string;
  contributionAmount: number;
  startMonth: string;
  finalValue: number;
  totalContributed: number;
  growth: number;
  walletBalance: number;
  months: { monthDate: string }[];
}

const START_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function PlanSetupScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [monthlyIncome, setMonthlyIncome] = useState<number | null>(null);

  const [contributionAmount, setContributionAmount] = useState("");
  const [startMonth, setStartMonth] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    apiFetch<ProfileResponse>("/user/profile")
      .then((profile) => {
        if (!cancelled) setMonthlyIncome(profile.monthlyIncome);
      })
      .catch(() => {
        /* profile not set up yet — contribution cap just won't show */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function validateRun(): string | null {
    if (!selectedPortfolioId) return "Select a portfolio.";
    const amount = Number(contributionAmount);
    if (!contributionAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      return "Enter a monthly contribution amount greater than 0.";
    }
    if (monthlyIncome !== null && amount > monthlyIncome) {
      return `Monthly contribution can't exceed your monthly income ($${monthlyIncome.toFixed(2)}).`;
    }
    if (!START_MONTH_PATTERN.test(startMonth.trim())) {
      return "Enter a start month as YYYY-MM, e.g. 2026-01.";
    }
    const earliest = portfolios.find((p) => p.id === selectedPortfolioId)?.earliestStartMonth;
    if (earliest && startMonth.trim() < earliest) {
      return `This portfolio's data starts in ${longMonth(earliest)}. Choose ${earliest} or later.`;
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
      const response = await apiFetch<PlanResult>("/plan", {
        method: "POST",
        body: {
          portfolioId: selectedPortfolioId,
          contributionAmount: Number(contributionAmount),
          startMonth: `${startMonth.trim()}-01`,
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
        <Text style={styles.title}>Plan started</Text>
        <View style={styles.resultCard}>
          <ResultRow label="Total contributed" value={formatCurrency(result.totalContributed)} />
          <ResultRow label="Growth" value={formatCurrency(result.growth)} />
          <ResultRow label="Final value" value={formatCurrency(result.finalValue)} emphasized />
          <ResultRow label="Wallet balance" value={formatCurrency(result.walletBalance)} />
        </View>
        <Text style={styles.historyNote}>
          {result.months.length} month{result.months.length === 1 ? "" : "s"} from {result.startMonth.slice(0, 7)} to{" "}
          {result.months[result.months.length - 1]?.monthDate.slice(0, 7)}.
        </Text>
        <Pressable style={styles.submitButton} onPress={() => navigation.navigate("Dashboard")}>
          <Text style={styles.submitButtonText}>View on Dashboard</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => setResult(null)}>
          <Text style={styles.secondaryButtonText}>Edit plan</Text>
        </Pressable>
      </View>
    );
  }

  const selectedPortfolio = portfolios.find((p) => p.id === selectedPortfolioId) ?? null;

  return (
    <KeyboardScreen contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Your plan</Text>
      <Text style={styles.subtitle}>Pick a portfolio, a monthly contribution, and a start month.</Text>

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
                {portfolio.earliestStartMonth && (
                  <Text style={styles.templateMeta}>Data from {longMonth(portfolio.earliestStartMonth)}</Text>
                )}
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Funds")}>
            <Text style={styles.secondaryButtonText}>Don't see what you want? Build one in the Funds tab →</Text>
          </Pressable>

          {selectedPortfolio && (
            <>
              <Text style={styles.label}>Monthly contribution</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 100"
                keyboardType="numeric"
                value={contributionAmount}
                onChangeText={setContributionAmount}
                editable={!submitting}
              />
              {monthlyIncome !== null && (
                <Text style={styles.templateMeta}>Up to ${monthlyIncome.toFixed(2)} (your monthly income)</Text>
              )}

              <Text style={styles.label}>Start month</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM, e.g. 2026-01"
                value={startMonth}
                onChangeText={setStartMonth}
                editable={!submitting}
              />
              <Text style={styles.templateMeta}>
                Your plan runs from this month through to the current month, using each fund's real monthly returns.
              </Text>
              {selectedPortfolio?.earliestStartMonth && (
                <Pressable onPress={() => setStartMonth(selectedPortfolio.earliestStartMonth!)} disabled={submitting}>
                  <Text style={styles.secondaryButtonText}>
                    Earliest for this portfolio: {selectedPortfolio.earliestStartMonth} — tap to use it
                  </Text>
                </Pressable>
              )}

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                onPress={handleRun}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Start plan</Text>}
              </Pressable>
            </>
          )}
        </View>
      )}
    </KeyboardScreen>
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

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09" -> "Sep 2026" */
function longMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
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
  optionColumn: { gap: 8 },
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
