/**
 * S-07 Friends — DECISIONS.md #8 (friends comparison, 3 Oct 2026). Where a
 * user manages the people they compare with: share their invite code, set
 * a display name, choose per metric what friends can see, add a friend by
 * code or exact email, answer incoming requests, and remove friends.
 *
 * Privacy rules this screen reflects (enforced server-side, friends.service.ts):
 *  - there is no search — you need someone's code or exact email;
 *  - the add-friend reply is always the same, so it can't reveal whether an
 *    account exists, and outgoing requests are deliberately not listed;
 *  - sharing is opt-in per metric, everything off by default.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";
import { KeyboardScreen } from "../components/KeyboardScreen";

/** Who sees a figure (DECISIONS.md #27): nobody, only the friends on your close-friends list, or every friend. */
type Audience = "NONE" | "CLOSE" | "ALL";

interface SharingSettings {
  shareInvestmentRate: Audience;
  shareConsistency: Audience;
  shareDiversification: Audience;
  shareReturn: Audience;
  shareMonthlyReturn: Audience;
  shareHoldings: Audience;
}

interface FriendLink {
  friendshipId: string;
  displayName: string;
  /** Whether you have put this friend on your close-friends list (only you can see this). */
  close?: boolean;
}

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "NONE", label: "Nobody" },
  { value: "CLOSE", label: "Close friends" },
  { value: "ALL", label: "All friends" },
];

interface FriendsOverview {
  inviteCode: string;
  displayName: string | null;
  sharing: SharingSettings;
  friends: FriendLink[];
  incomingRequests: FriendLink[];
}

const SHARE_OPTIONS: { key: keyof SharingSettings; label: string; hint: string }[] = [
  { key: "shareReturn", label: "Portfolio return", hint: "How much your portfolio has grown or shrunk, as a %" },
  { key: "shareMonthlyReturn", label: "Monthly portfolio return", hint: "How much your portfolio grew or shrank in the latest month, as a %" },
  { key: "shareInvestmentRate", label: "Monthly investment rate", hint: "How much of your income you put into investments each month, as a %" },
  { key: "shareConsistency", label: "Contribution consistency", hint: "The share of recent months in which you bought something" },
  { key: "shareDiversification", label: "Diversification score", hint: "How widely your money is spread, 0 to 100" },
  {
    key: "shareHoldings",
    label: "Holdings",
    hint: "The funds in your plan and each one's weight (percentages only, never amounts). Custom portfolio names stay private.",
  },
];

export function FriendsScreen() {
  const [overview, setOverview] = useState<FriendsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);

  const [addInput, setAddInput] = useState("");
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(null);

    apiFetch<FriendsOverview>("/friends")
      .then((res) => {
        if (cancelled) return;
        setOverview(res);
        setNameInput((prev) => (nameDirty ? prev : res.displayName ?? ""));
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

  useFocusEffect(load);

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(describeError(err));
    }
    load();
  }

  async function saveName() {
    setNameMessage(null);
    try {
      await apiFetch("/friends/settings", { method: "PUT", body: { displayName: nameInput } });
      setNameDirty(false);
      setNameMessage("Saved.");
    } catch (err) {
      setNameMessage(describeError(err));
    }
    load();
  }

  function chooseAudience(key: keyof SharingSettings, value: Audience) {
    // Optimistic: change it now, and let the reload reconcile if the save fails.
    setOverview((prev) => (prev ? { ...prev, sharing: { ...prev.sharing, [key]: value } } : prev));
    run(() => apiFetch("/friends/settings", { method: "PUT", body: { [key]: value } }));
  }

  function setClose(friendshipId: string, close: boolean) {
    setOverview((prev) => (prev ? { ...prev, friends: prev.friends.map((f) => (f.friendshipId === friendshipId ? { ...f, close } : f)) } : prev));
    run(() => apiFetch(`/friends/${friendshipId}/close`, { method: "PUT", body: { close } }));
  }

  async function sendRequest() {
    const value = addInput.trim();
    if (!value) {
      setAddError("Enter a friend's invite code or email.");
      return;
    }
    setAddError(null);
    setAddMessage(null);
    setAdding(true);
    try {
      const body = value.includes("@") ? { email: value } : { code: value };
      const res = await apiFetch<{ message: string }>("/friends/requests", { method: "POST", body });
      setAddMessage(res.message);
      setAddInput("");
    } catch (err) {
      setAddError(describeError(err));
    } finally {
      setAdding(false);
    }
    load();
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (loadError || !overview) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{loadError ?? "Couldn't load your friends."}</Text>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const needsName = !overview.displayName;

  return (
    <KeyboardScreen contentContainerStyle={styles.scrollContainer}>
      <View style={styles.card}>
        <Text style={styles.cardHeading}>Your invite code</Text>
        <Text selectable style={styles.code}>
          {overview.inviteCode}
        </Text>
        <Text style={styles.hint}>Share this with a friend so they can send you a request.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Display name</Text>
        <Text style={styles.hint}>This is the only thing friends see about you — never your email.</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Hao"
          value={nameInput}
          maxLength={30}
          onChangeText={(t) => {
            setNameInput(t);
            setNameDirty(true);
            setNameMessage(null);
          }}
        />
        <Pressable style={[styles.primaryButton, !nameInput.trim() && styles.buttonDisabled]} onPress={saveName} disabled={!nameInput.trim()}>
          <Text style={styles.primaryButtonText}>Save name</Text>
        </Pressable>
        {nameMessage && <Text style={styles.hint}>{nameMessage}</Text>}
        {needsName && <Text style={styles.warning}>Set a display name before you can add or accept friends.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>What friends can see</Text>
        <Text style={styles.hint}>
          Nobody sees anything until you choose. For each item pick who: every friend, or only your close friends. You always see your own
          stats.
        </Text>
        {SHARE_OPTIONS.map((opt) => (
          <View key={opt.key} style={styles.shareBlock}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>{opt.label}</Text>
              <Text style={styles.hint}>{opt.hint}</Text>
            </View>
            <View style={styles.segment}>
              {AUDIENCES.map((a) => {
                const selected = overview.sharing[opt.key] === a.value;
                return (
                  <Pressable
                    key={a.value}
                    style={[styles.segmentButton, selected && styles.segmentButtonSelected]}
                    onPress={() => chooseAudience(opt.key, a.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${opt.label}: ${a.label}`}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <Text style={styles.hint}>
          Your close friends are chosen in the list of friends below. It is private: nobody is told whether they are on it.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Add a friend</Text>
        <Text style={styles.hint}>Enter their invite code or exact email. There's no search.</Text>
        <TextInput
          style={styles.input}
          placeholder="Invite code or email"
          autoCapitalize="none"
          value={addInput}
          onChangeText={setAddInput}
          editable={!adding}
        />
        <Pressable style={[styles.primaryButton, adding && styles.buttonDisabled]} onPress={sendRequest} disabled={adding}>
          {adding ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Send request</Text>}
        </Pressable>
        {addMessage && <Text style={styles.success}>{addMessage}</Text>}
        {addError && <Text style={styles.error}>{addError}</Text>}
      </View>

      {overview.incomingRequests.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Requests for you</Text>
          {overview.incomingRequests.map((req) => (
            <View key={req.friendshipId} style={styles.personRow}>
              <Text style={styles.personName} numberOfLines={1}>
                {req.displayName}
              </Text>
              <Pressable
                style={styles.smallPrimary}
                onPress={() => run(() => apiFetch(`/friends/requests/${req.friendshipId}/accept`, { method: "POST" }))}
              >
                <Text style={styles.smallPrimaryText}>Accept</Text>
              </Pressable>
              <Pressable style={styles.smallSecondary} onPress={() => run(() => apiFetch(`/friends/${req.friendshipId}`, { method: "DELETE" }))}>
                <Text style={styles.smallSecondaryText}>Decline</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardHeading}>Your friends ({overview.friends.length})</Text>
        {overview.friends.length === 0 && <Text style={styles.hint}>No friends yet.</Text>}
        {overview.friends.length > 0 && <Text style={styles.hint}>Tap the star to add a friend to your close friends. Only you see this list.</Text>}
        {overview.friends.map((f) => (
          <View key={f.friendshipId} style={styles.personRow}>
            <Pressable
              onPress={() => setClose(f.friendshipId, !f.close)}
              accessibilityRole="button"
              accessibilityState={{ selected: !!f.close }}
              accessibilityLabel={f.close ? `Remove ${f.displayName} from close friends` : `Add ${f.displayName} to close friends`}
              hitSlop={8}
            >
              <Text style={[styles.star, f.close && styles.starOn]}>{f.close ? "★" : "☆"}</Text>
            </Pressable>
            <Text style={styles.personName} numberOfLines={1}>
              {f.displayName}
            </Text>
            {confirmingId === f.friendshipId ? (
              <>
                <Pressable
                  style={styles.smallDanger}
                  onPress={() => {
                    setConfirmingId(null);
                    run(() => apiFetch(`/friends/${f.friendshipId}`, { method: "DELETE" }));
                  }}
                >
                  <Text style={styles.smallPrimaryText}>Confirm</Text>
                </Pressable>
                <Pressable style={styles.smallSecondary} onPress={() => setConfirmingId(null)}>
                  <Text style={styles.smallSecondaryText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.smallSecondary} onPress={() => setConfirmingId(f.friendshipId)}>
                <Text style={styles.smallSecondaryText}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>

      {actionError && <Text style={styles.error}>{actionError}</Text>}
    </KeyboardScreen>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Something went wrong. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  scrollContainer: { flexGrow: 1, alignItems: "center", padding: 24, gap: 12 },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  cardHeading: { fontSize: 16, fontWeight: "600" },
  code: { fontSize: 28, fontWeight: "700", letterSpacing: 4, color: "#2e6fdb" },
  hint: { fontSize: 12, color: "#777" },
  warning: { fontSize: 12, color: "#b9770e" },
  success: { fontSize: 13, color: "#2e8b57" },
  error: { color: "#c0392b", textAlign: "center" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  primaryButton: { backgroundColor: "#2e6fdb", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#2e6fdb", fontWeight: "600" },
  shareBlock: { gap: 6, paddingVertical: 6 },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: "#ccc", borderRadius: 8, overflow: "hidden" },
  segmentButton: { flex: 1, paddingVertical: 8, alignItems: "center" },
  segmentButtonSelected: { backgroundColor: "#eaf1fd" },
  segmentText: { fontSize: 12, color: "#555", fontWeight: "600" },
  segmentTextSelected: { color: "#2e6fdb" },
  star: { fontSize: 22, color: "#bbb", width: 28, textAlign: "center" },
  starOn: { color: "#e0a800" },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 14, fontWeight: "600", color: "#333" },
  personRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  personName: { flex: 1, fontSize: 15, color: "#333" },
  smallPrimary: { backgroundColor: "#2e6fdb", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  smallPrimaryText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  smallDanger: { backgroundColor: "#c0392b", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  smallSecondary: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  smallSecondaryText: { color: "#555", fontWeight: "600", fontSize: 13 },
});
