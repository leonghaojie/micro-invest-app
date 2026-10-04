/**
 * Forgot password (DECISIONS.md #10, FR22/FR23). Two steps on one screen:
 *   1. enter the account email  -> POST /auth/forgot-password (emails a code)
 *   2. enter code + new password -> POST /auth/reset-password
 * Resetting does not log the user in; they return to the login screen.
 *
 * Step 1 always advances, whether or not the email has an account — the
 * server answers identically so this screen can't be used to find out who is
 * registered.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, ApiError } from "../api/client";
import type { RootStackScreenProps } from "../navigation/AppNavigator";
import { KeyboardScreen } from "../components/KeyboardScreen";

type Props = RootStackScreenProps<"ForgotPassword">;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordScreen({ navigation, route }: Props) {
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode() {
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/forgot-password", { method: "POST", skipAuth: true, body: { email: email.trim() } });
      setStep("reset");
      setNotice("If that email has an account, we've sent a 6-digit code. It expires in 15 minutes.");
    } catch (err) {
      setError(describeError(err, "Could not send the code. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        skipAuth: true,
        body: { email: email.trim(), code: code.trim(), password },
      });
      navigation.reset({ index: 0, routes: [{ name: "WelcomeLogin", params: { passwordResetDone: true } }] });
    } catch (err) {
      setError(describeError(err, "Could not reset your password. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.subtitle}>
        {step === "email" ? "We'll email you a 6-digit code." : `Enter the code sent to ${email.trim()}.`}
      </Text>

      <View style={styles.form}>
        {step === "email" ? (
          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            editable={!submitting}
          />
        ) : (
          <>
            {notice && <Text style={styles.notice}>{notice}</Text>}
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              value={code}
              onChangeText={setCode}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="New password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              value={confirm}
              onChangeText={setConfirm}
              editable={!submitting}
            />
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={step === "email" ? sendCode : resetPassword}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{step === "email" ? "Send code" : "Reset password"}</Text>
          )}
        </Pressable>

        {step === "reset" && (
          <Pressable
            onPress={() => {
              setStep("email");
              setError(null);
              setNotice(null);
              setCode("");
            }}
            disabled={submitting}
          >
            <Text style={styles.linkText}>Didn't get a code? Send a new one</Text>
          </Pressable>
        )}

        <Pressable onPress={() => navigation.goBack()} disabled={submitting}>
          <Text style={styles.linkText}>Back to log in</Text>
        </Pressable>
      </View>
    </KeyboardScreen>
  );
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? fallback;
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 15, color: "#555", marginBottom: 16, textAlign: "center" },
  form: { width: "100%", maxWidth: 360, gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  notice: { color: "#555", textAlign: "center" },
  error: { color: "#c0392b", textAlign: "center" },
  submitButton: {
    backgroundColor: "#2e6fdb",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  linkText: { color: "#2e6fdb", textAlign: "center", marginTop: 4 },
});
