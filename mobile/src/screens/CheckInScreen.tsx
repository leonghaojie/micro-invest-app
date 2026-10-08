/**
 * Monthly check-in (DECISIONS.md #31): what did you earn and spend this month?
 *
 * The profile's income and expenses are the usual figures; each month's cash starts from them.
 * Here the user confirms them, or reports what really happened (a bonus, a big purchase). The
 * answer is for this month only unless "make these my usual figures" is ticked, so a one-off
 * expense is never repeated next month. Spending more than was earned is fine: it comes out of
 * the cash the account has, and the screen says so before the user saves. GET/PUT /checkin/current.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { apiFetch, ApiError } from "../api/client";
import { KeyboardScreen } from "../components/KeyboardScreen";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { formatCurrency } from "../utils/peerFormat";

type Props = NativeStackScreenProps<RootStackParamList, "CheckIn">;

export interface CheckInView {
  month: string;
  confirmed: boolean;
  usual: { income: number; expense: number };
  thisMonth: { income: number; expense: number };
  credit: number;
  cash: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: string) => `${MONTH_NAMES[Number(m.split("-")[1]) - 1]} ${m.split("-")[0]}`;

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Something went wrong. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const toAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function CheckInScreen({ navigation }: Props) {
  const [view, setView] = useState<CheckInView | null>(null);
  const [income, setIncome] = useState("");
  const [expense, setExpense] = useState("");
  const [makeUsual, setMakeUsual] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(null);
    apiFetch<CheckInView>("/checkin/current")
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setIncome(String(v.thisMonth.income));
        setExpense(String(v.thisMonth.expense));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{loadError}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!view) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const incomeNum = toAmount(income);
  const expenseNum = toAmount(expense);
  const valid = incomeNum !== null && expenseNum !== null;
  const newCredit = valid ? Math.round((incomeNum - expenseNum) * 100) / 100 : null;
  // Cash after this change: today's cash, with this month's credit swapped for the new one.
  const cashAfter = newCredit !== null ? Math.round((view.cash - view.credit + newCredit) * 100) / 100 : null;
  const cannotCover = cashAfter !== null && cashAfter < -0.005;
  const unchanged = valid && incomeNum === view.thisMonth.income && expenseNum === view.thisMonth.expense;
  const sameAsUsual = valid && incomeNum === view.usual.income && expenseNum === view.usual.expense;

  async function save() {
    if (!valid || cannotCover) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch<CheckInView>("/checkin/current", { method: "PUT", body: { income: incomeNum, expense: expenseNum, makeUsual: makeUsual && !sameAsUsual } });
      navigation.goBack();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  const label = !view.confirmed && unchanged ? "Confirm these figures" : "Save this month";

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>{monthName(view.month)}</Text>
      <Text style={styles.subtitle}>
        What did you earn and spend this month? Your cash starts from your usual figures; change them here if this month was different, such as a bonus or a big purchase.
      </Text>

      <View style={styles.form}>
        <Text style={styles.label}>Income this month (SGD)</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={income} onChangeText={setIncome} editable={!saving} accessibilityLabel="Income this month" />
        <Text style={styles.label}>Spending this month (SGD)</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={expense} onChangeText={setExpense} editable={!saving} accessibilityLabel="Spending this month" />
        <Text style={styles.hint}>
          Your usual: {formatCurrency(view.usual.income)} income, {formatCurrency(view.usual.expense)} spending.
        </Text>

        {newCredit !== null && (
          <View style={[styles.result, cannotCover && styles.resultBad]}>
            {newCredit >= 0 ? (
              <Text style={styles.resultText}>This month adds {formatCurrency(newCredit)} to your cash.</Text>
            ) : (
              <Text style={styles.resultText}>
                You spent {formatCurrency(-newCredit)} more than you earned. That comes out of your cash.
              </Text>
            )}
            {cannotCover ? (
              <Text style={styles.resultBadText}>
                You only have {formatCurrency(Math.max(0, view.cash - view.credit))} in cash besides this month. Sell something first, or enter a smaller amount.
              </Text>
            ) : (
              <Text style={styles.resultSub}>Cash after this: {formatCurrency(cashAfter ?? 0)}</Text>
            )}
          </View>
        )}

        {!sameAsUsual && valid && (
          <Pressable style={styles.checkRow} onPress={() => setMakeUsual((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: makeUsual }} accessibilityLabel="Make these my usual monthly figures">
            <View style={[styles.box, makeUsual && styles.boxOn]}>{makeUsual && <Text style={styles.tick}>✓</Text>}</View>
            <View style={styles.checkText}>
              <Text style={styles.checkTitle}>Make these my usual monthly figures</Text>
              <Text style={styles.hint}>
                Tick this only if your pay or spending has really changed. Leave it off for a one-off, so it does not carry into next month.
              </Text>
            </View>
          </Pressable>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.submit, (!valid || cannotCover || saving) && styles.submitDisabled]} onPress={save} disabled={!valid || cannotCover || saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{label}</Text>}
        </Pressable>
        <Text style={styles.foot}>Next month starts again from your usual figures, and you will be asked again.</Text>
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  container: { flexGrow: 1, alignItems: "center", padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 8, textAlign: "center", maxWidth: 340 },
  form: { width: "100%", maxWidth: 360, gap: 8 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  hint: { fontSize: 12, color: "#777" },
  result: { backgroundColor: "#eaf1fd", borderRadius: 8, padding: 12, gap: 4, marginTop: 4 },
  resultBad: { backgroundColor: "#fdecea" },
  resultText: { fontSize: 14, fontWeight: "600", color: "#1f3b73" },
  resultSub: { fontSize: 12, color: "#555" },
  resultBadText: { fontSize: 13, color: "#c0392b" },
  checkRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 8 },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: "#999", alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: "#2e6fdb", borderColor: "#2e6fdb" },
  tick: { color: "#fff", fontWeight: "700", fontSize: 14 },
  checkText: { flex: 1, gap: 2 },
  checkTitle: { fontSize: 14, fontWeight: "600" },
  submit: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  foot: { fontSize: 11, color: "#999", textAlign: "center" },
  error: { color: "#c0392b" },
  link: { color: "#2e6fdb", fontWeight: "600" },
});
