/**
 * S-03 Simulation Setup — UC-03. Select portfolio template + plan
 * parameters, run the deterministic simulation (FR05/06/07,
 * simulation.service.ts), then continue to S-04 Dashboard.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SimulationSetup">;

type Frequency = "WEEKLY" | "MONTHLY";

interface PortfolioTemplate {
  id: string;
  name: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  expectedReturn: number;
}

interface RunSimulationResult {
  simulationId: string;
  finalValue: number;
  totalContributed: number;
  growth: number;
  // DECISIONS.md #1 amendment: true when this plan's duration outlasted
  // the real historical-return series for the chosen template, so history
  // was replayed from its start to fill the remaining periods.
  historyWrapped: boolean;
}

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

export function SimulationSetupScreen({ navigation }: Props) {
  const [templates, setTemplates] = useState<PortfolioTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [contributionAmount, setContributionAmount] = useState("");
  const [durationMonths, setDurationMonths] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunSimulationResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<PortfolioTemplate[]>("/portfolio/templates")
      .then((data) => {
        if (cancelled) return;
        setTemplates(data);
        if (data.length > 0) setSelectedTemplateId(data[0].id);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function validate(): string | null {
    if (!selectedTemplateId) return "Select a portfolio template.";
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

  async function handleSubmit() {
    const validationError = validate();
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
          templateId: selectedTemplateId,
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

  if (loadingTemplates) {
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
            This plan runs longer than the real historical data available for this portfolio, so its return history
            was replayed from the start to fill the remaining years.
          </Text>
        )}
        <Pressable style={styles.submitButton} onPress={() => navigation.replace("Dashboard")}>
          <Text style={styles.submitButtonText}>Continue to Dashboard</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <Text style={styles.title}>Set up your simulation</Text>
      <Text style={styles.subtitle}>Pick a portfolio and a contribution plan.</Text>

      {loadError && <Text style={styles.error}>{loadError}</Text>}

      {!loadError && templates.length === 0 && (
        <Text style={styles.error}>No portfolio templates available yet. Check back later.</Text>
      )}

      {templates.length > 0 && (
        <View style={styles.form}>
          <Text style={styles.label}>Portfolio template</Text>
          <View style={styles.optionColumn}>
            {templates.map((template) => (
              <Pressable
                key={template.id}
                style={[styles.templateCard, selectedTemplateId === template.id && styles.optionButtonSelected]}
                onPress={() => setSelectedTemplateId(template.id)}
                disabled={submitting}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    selectedTemplateId === template.id && styles.optionButtonTextSelected,
                  ]}
                >
                  {template.name}
                </Text>
                <Text style={styles.templateMeta}>
                  {template.riskLevel} risk · {(template.expectedReturn * 100).toFixed(1)}% expected annual return
                </Text>
              </Pressable>
            ))}
          </View>

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

          <Text style={styles.label}>Contribution amount (SGD per period)</Text>
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
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Run simulation</Text>}
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
