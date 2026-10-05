/**
 * S-02 Profile Setup — UC-02. Collect risk level, goal type, monthly
 * income, monthly expense, and age; POST /user/profile.
 *
 * DECISIONS.md #1 third amendment / #2 rewrite (25 Aug 2026): the old
 * "monthly budget -> budgetBand" field is gone — contribution amount now
 * lives on the plan (PlanSetupScreen), capped by monthlyIncome, not by a
 * separate "budget" concept. monthlyIncome also drives peer grouping
 * (±10%-widening income range) and, with monthlyExpense, the Savings Rate
 * metric shown back here once saved. riskLevel/goalType are kept
 * (unused for grouping now) per explicit user direction.
 *
 * On mount, GETs the existing profile to pre-fill for a returning user
 * editing their profile.
 *
 * DECISIONS.md #19: the same form is the "Edit profile" screen (route EditProfile), so a
 * person can report a new job or new expenses at any time. Saving a first profile opens the
 * account (this month's spare income becomes the opening cash); editing income or expenses
 * re-prices only this month's cash, and past months never change. The server refuses a change
 * that would leave cash below zero, and its message is shown here.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackScreenProps } from "../navigation/AppNavigator";
import { KeyboardScreen } from "../components/KeyboardScreen";

type Props = RootStackScreenProps<"ProfileSetup"> | RootStackScreenProps<"EditProfile">;

type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
type GoalType = "LEARN" | "HABIT" | "GROWTH";
type ExperienceLevel = "BEGINNER" | "INTERMEDIATE" | "EXPERIENCED";

interface ProfileResponse {
  riskLevel: RiskLevel;
  goalType: GoalType;
  monthlyIncome: number;
  monthlyExpense: number;
  age: number;
  experienceLevel: ExperienceLevel;
  savingsRatePct: number;
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

// DECISIONS.md #18: investing experience, so the peer comparison can match beginners with
// beginners. Self-reported; it only ever affects which peers you are compared with.
const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "BEGINNER", label: "New to investing" },
  { value: "INTERMEDIATE", label: "1–3 years" },
  { value: "EXPERIENCED", label: "More than 3 years" },
];

export function ProfileSetupScreen({ navigation, route }: Props) {
  const isEdit = route.name === "EditProfile";
  const [riskLevel, setRiskLevel] = useState<RiskLevel | null>(null);
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("BEGINNER");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [monthlyExpense, setMonthlyExpense] = useState("");
  const [age, setAge] = useState("");
  const [currentSavingsRate, setCurrentSavingsRate] = useState<number | null>(null);
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
        if (profile.experienceLevel) setExperienceLevel(profile.experienceLevel);
        setMonthlyIncome(String(profile.monthlyIncome));
        setMonthlyExpense(String(profile.monthlyExpense));
        setAge(String(profile.age));
        setCurrentSavingsRate(profile.savingsRatePct);
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
    const income = Number(monthlyIncome);
    if (!monthlyIncome.trim() || !Number.isFinite(income) || income <= 0) {
      return "Enter a monthly income greater than 0.";
    }
    const expense = Number(monthlyExpense);
    if (!monthlyExpense.trim() || !Number.isFinite(expense) || expense < 0) {
      return "Enter a monthly expense of 0 or more.";
    }
    const ageNum = Number(age);
    if (!age.trim() || !Number.isInteger(ageNum) || ageNum < 13 || ageNum > 120) {
      return "Enter a realistic age.";
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
        body: {
          riskLevel,
          goalType,
          experienceLevel,
          monthlyIncome: Number(monthlyIncome),
          monthlyExpense: Number(monthlyExpense),
          age: Number(age),
        },
      });
      if (isEdit) {
        navigation.goBack();
      } else {
        // Straight to the Portfolios tab: with cash credited, buying something is the next step.
        navigation.replace("Main", { screen: "Contribution" });
      }
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
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>{isEdit ? "Edit your profile" : "Set up your profile"}</Text>
      <Text style={styles.subtitle}>
        {isEdit
          ? "Changes to income or expenses update this month's cash only; past months stay as they were."
          : "Your income and expenses decide how much cash you can invest each month, and shape your peer comparisons."}
      </Text>

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

        <Text style={styles.label}>How long have you been investing?</Text>
        <View style={styles.optionColumn}>
          {EXPERIENCE_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              label={option.label}
              selected={experienceLevel === option.value}
              disabled={submitting}
              onPress={() => setExperienceLevel(option.value)}
              fullWidth
            />
          ))}
        </View>

        <Text style={styles.label}>Monthly income (SGD)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 4000"
          keyboardType="numeric"
          value={monthlyIncome}
          onChangeText={setMonthlyIncome}
          editable={!submitting}
        />

        <Text style={styles.label}>Monthly expense (SGD)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 2500"
          keyboardType="numeric"
          value={monthlyExpense}
          onChangeText={setMonthlyExpense}
          editable={!submitting}
        />
        {currentSavingsRate !== null && (
          <Text style={styles.hint}>Current Savings Rate: {currentSavingsRate.toFixed(0)}%</Text>
        )}

        <Text style={styles.label}>Age</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 28"
          keyboardType="numeric"
          value={age}
          onChangeText={setAge}
          editable={!submitting}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>{isEdit ? "Save changes" : "Continue"}</Text>}
        </Pressable>
      </View>
    </KeyboardScreen>
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
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
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
