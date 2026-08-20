/**
 * S-01 Welcome / Login — UC-01. Authenticate user and enter system.
 * Toggles between /auth/login (FR02) and /auth/register (FR01). On success
 * the JWT is stored (mobile/src/api/client.ts) and the stack is reset past
 * this screen — login goes straight to S-04 Dashboard (returning, already
 * onboarded user); register goes to S-02 Profile Setup (first-time user),
 * per the flow documented in AppNavigator.tsx.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, ApiError, setStoredAuthToken } from "../api/client";
import type { RootStackScreenProps } from "../navigation/AppNavigator";

type Props = RootStackScreenProps<"WelcomeLogin">;

type Mode = "login" | "register";

interface AuthResponse {
  token: string;
  user: { id: string; email: string };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WelcomeLoginScreen({ navigation }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLogin = mode === "login";

  function validate(): string | null {
    if (!EMAIL_PATTERN.test(email.trim())) {
      return "Enter a valid email address.";
    }
    if (password.length < 8) {
      return "Password must be at least 8 characters.";
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
      const path = isLogin ? "/auth/login" : "/auth/register";
      const result = await apiFetch<AuthResponse>(path, {
        method: "POST",
        skipAuth: true,
        body: { email: email.trim(), password },
      });

      await setStoredAuthToken(result.token);

      // Reset rather than navigate: a logged-in user shouldn't be able to
      // swipe/back into the login form. Login assumes an already-onboarded
      // user and goes straight to the tab bar; register still needs
      // ProfileSetup first.
      navigation.reset({
        index: 0,
        routes: [{ name: isLogin ? "Main" : "ProfileSetup" }],
      });
    } catch (err) {
      setError(describeError(err, isLogin));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Micro-Invest</Text>
      <Text style={styles.subtitle}>{isLogin ? "Log in to continue" : "Create your account"}</Text>

      <View style={styles.form}>
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
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          autoCapitalize="none"
          autoComplete={isLogin ? "current-password" : "new-password"}
          textContentType={isLogin ? "password" : "newPassword"}
          value={password}
          onChangeText={setPassword}
          editable={!submitting}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{isLogin ? "Log in" : "Register"}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(isLogin ? "register" : "login");
            setError(null);
          }}
          disabled={submitting}
        >
          <Text style={styles.toggleText}>
            {isLogin ? "New here? Create an account" : "Already have an account? Log in"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function describeError(err: unknown, isLogin: boolean): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? (isLogin ? "Log in failed. Please try again." : "Registration failed. Please try again.");
  }
  // fetch() itself threw (offline, DNS failure, etc.) rather than the
  // server returning a non-2xx response.
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 15, color: "#555", marginBottom: 16 },
  form: { width: "100%", maxWidth: 360, gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
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
  toggleText: { color: "#2e6fdb", textAlign: "center", marginTop: 4 },
});
