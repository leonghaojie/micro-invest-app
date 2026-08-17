/**
 * S-02 Profile Setup — UC-02. Collect risk level, goal type, and monthly
 * budget; POST /user/profile (budgetBand is derived server-side from the
 * raw budget figure — profile.service.ts, Design Model §4.2).
 *
 * On mount, GETs the existing profile to pre-select risk/goal for a
 * returning user editing their profile. The raw monthly budget number
 * itself isn't persisted (only the derived band is), so that field always
 * starts blank — existing users see their current band as a hint instead.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ProfileSetup">;

type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
type GoalType = "LEARN" | "HABIT" | "GROWTH";

interface ProfileResponse {
  riskLevel: RiskLevel;
  goalType: GoalType;
  budgetBand: "B1" | "B2" | "B3" | "B4";
}

const RISK_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const GOAL_OPTIONS: { value: GoalType; label: string }[] = [
  { value: "LEARN", label: "Learn the basics" },
  { value: "HABIT", label: "Build a habit" },
  { value: "GROWTH", label: "Grow my money" },
];

export function ProfileSetupScreen({ navigation }: Props) {
  const [riskLevel, setRiskLevel] = useState<RiskLevel | null>(null);
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [currentBand, setCurrentBand] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<ProfileResponse>("/user/profile")
      .then((profile) => {
        if (cancelled) return;
        setRiskLevel(profile.riskLevel);
        setGoalType(profile.goalType);
        setCurrentBand(profile.budgetBand);
      })
      .catch((err) => {
        // 404 just means "no profile yet" — the normal first-time state,
        // not an error worth surfacing.
        if (!cancelled && !(err instanceof ApiError && err.status === 404)) {
          setError("Couldn't load your existing profile. You can still fill in the form below.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function validate(): string | null {
    if (!riskLevel) return "Select a risk level.";
    if (!goalType) return "Select a goal.";
    const budget = Number(monthlyBudget);
    if (!monthlyBudget.trim() || !Number.isFinite(budget) || budget <= 0) {
      return "Enter a monthly budget greater than 0.";
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
      await apiFetch<ProfileResponse>("/user/profile", {
        method: "POST",
        body: { riskLevel, goalType, monthlyBudget: Number(monthlyBudget) },
      });
      navigation.replace("SimulationSetup");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingExisting) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Set up your profile</Text>
      <Text style={styles.subtitle}>This shapes your simulation and peer comparisons.</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Risk level</Text>
        <View style={styles.optionRow}>
          {RISK_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              label={option.label}
              selected={riskLevel === option.value}
              disabled={submitting}
              onPress={() => setRiskLevel(option.value)}
            />
          ))}
        </View>

        <Text style={styles.label}>Goal</Text>
        <View style={styles.optionColumn}>
          {GOAL_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              label={option.label}
              selected={goalType === option.value}
              disabled={submitting}
              onPress={() => setGoalType(option.value)}
              fullWidth
            />
          ))}
        </View>

        <Text style={styles.label}>Monthly budget (SGD)</Text>
        {currentBand && (
          <Text style={styles.hint}>Currently in band {currentBand}. Enter a new figure to update it.</Text>
        )}
        <TextInput
          style={styles.input}
          placeholder="e.g. 100"
          keyboardType="numeric"
          value={monthlyBudget}
          onChangeText={setMonthlyBudget}
          editable={!submitting}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Continue</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function OptionButton({
  label,
  selected,
  disabled,
  onPress,
  fullWidth,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  fullWidth?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.optionButton,
        fullWidth && styles.optionButtonFullWidth,
        selected && styles.optionButtonSelected,
        disabled && styles.optionButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.optionButtonText, selected && styles.optionButtonTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Couldn't save your profile. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 16, textAlign: "center" },
  form: { width: "100%", maxWidth: 360, gap: 8 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 12 },
  hint: { fontSize: 12, color: "#777" },
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
  optionButtonFullWidth: { flex: undefined, alignItems: "flex-start" },
  optionButtonSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  optionButtonDisabled: { opacity: 0.6 },
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
  submitButton: {
    backgroundColor: "#2e6fdb",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
