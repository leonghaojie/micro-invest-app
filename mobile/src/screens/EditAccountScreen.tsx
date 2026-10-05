/**
 * Edit one account detail (DECISIONS.md #17): display name, email, or password,
 * opened from the Account section of the dashboard. One screen, three small forms,
 * so the dashboard stays a list and each change gets a screen of its own.
 *
 *  - name:     PUT  /friends/settings {displayName}   (the same name friends see)
 *  - email:    PUT  /auth/email {newEmail, password}   (needs the current password)
 *  - password: POST /auth/change-password {currentPassword, newPassword}
 *
 * A wrong current password comes back as 403, not 401, so a typo here shows a
 * message instead of signing the user out.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { KeyboardScreen } from "../components/KeyboardScreen";
import type { RootStackScreenProps } from "../navigation/AppNavigator";

type Props = RootStackScreenProps<"EditAccount">;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 30;

interface Me {
  user: { id: string; email: string; displayName: string | null };
}

export function EditAccountScreen({ navigation, route }: Props) {
  const { kind } = route.params;

  const [me, setMe] = useState<Me["user"] | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<Me>("/auth/me")
      .then((res) => {
        if (cancelled) return;
        setMe(res.user);
        setName(res.user.displayName ?? "");
      })
      .catch(() => undefined) // the form still works without the prefill
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  function validate(): string | null {
    if (kind === "name") {
      if (!name.trim()) return "Enter a display name.";
      if (name.trim().length > NAME_MAX) return `Display name is at most ${NAME_MAX} characters.`;
    }
    if (kind === "email") {
      if (!EMAIL_PATTERN.test(newEmail.trim())) return "Enter a valid email address.";
      if (!currentPassword) return "Enter your current password to confirm.";
    }
    if (kind === "password") {
      if (!currentPassword) return "Enter your current password.";
      if (newPassword.length < 8) return "New password must be at least 8 characters.";
      if (newPassword !== confirm) return "The new passwords don't match.";
      if (newPassword === currentPassword) return "Your new password must be different from the current one.";
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (kind === "name") {
        await apiFetch("/friends/settings", { method: "PUT", body: { displayName: name.trim() } });
        setDone("Display name saved.");
      } else if (kind === "email") {
        await apiFetch("/auth/email", { method: "PUT", body: { newEmail: newEmail.trim(), password: currentPassword } });
        setDone("Email updated. Use it the next time you log in.");
      } else {
        await apiFetch("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
        setDone("Password updated.");
      }
      // never keep passwords around once used
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.center}>
        <Text style={styles.success}>{done}</Text>
        <Pressable style={styles.primaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryButtonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <View style={styles.form}>
        {kind === "name" && (
          <>
            <Text style={styles.heading}>Display name</Text>
            <Text style={styles.hint}>This is the name your friends see. It is not your login.</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Hao"
              value={name}
              onChangeText={setName}
              maxLength={NAME_MAX}
              editable={!submitting}
              autoCapitalize="words"
            />
          </>
        )}

        {kind === "email" && (
          <>
            <Text style={styles.heading}>Email</Text>
            {me && <Text style={styles.hint}>Currently {me.email}</Text>}
            <TextInput
              style={styles.input}
              placeholder="New email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={newEmail}
              onChangeText={setNewEmail}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Current password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              editable={!submitting}
            />
            <Text style={styles.hint}>
              We don't send a confirmation to the new address, so check it carefully: password reset codes are sent there.
            </Text>
          </>
        )}

        {kind === "password" && (
          <>
            <Text style={styles.heading}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Current password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="New password (at least 8 characters)"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              value={newPassword}
              onChangeText={setNewPassword}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              value={confirm}
              onChangeText={setConfirm}
              editable={!submitting}
            />
            <Text style={styles.hint}>Other devices where you're signed in stay signed in until their session expires.</Text>
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.primaryButton, submitting && styles.disabled]} onPress={save} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save</Text>}
        </Pressable>
      </View>
    </KeyboardScreen>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; details?: { fieldErrors?: Record<string, string[]> } } | undefined;
    const firstField = body?.details?.fieldErrors ? Object.values(body.details.fieldErrors).flat()[0] : undefined;
    return firstField ?? body?.error ?? "Couldn't save that. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  container: { flexGrow: 1, alignItems: "center", padding: 24 },
  form: { width: "100%", maxWidth: 360, gap: 12 },
  heading: { fontSize: 20, fontWeight: "700" },
  hint: { fontSize: 12, color: "#777" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  error: { color: "#c0392b", textAlign: "center" },
  success: { fontSize: 16, color: "#1e8449", fontWeight: "600", textAlign: "center" },
  primaryButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
