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
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";

interface SharingSettings {
  shareValue: boolean;
  shareReturn: boolean;
  shareContributionRate: boolean;
  shareSavingsRate: boolean;
  shareEmergencyBuffer: boolean;
}

interface FriendLink {
  friendshipId: string;
  displayName: string;
}

interface FriendsOverview {
  inviteCode: string;
  displayName: string | null;
  sharing: SharingSettings;
  friends: FriendLink[];
  incomingRequests: FriendLink[];
}

const SHARE_OPTIONS: { key: keyof SharingSettings; label: string; hint: string }[] = [
  { key: "shareValue", label: "Portfolio value", hint: "Your plan's current value" },
  { key: "shareReturn", label: "Return", hint: "Growth as a % of what you've contributed" },
  { key: "shareContributionRate", label: "Contribution rate", hint: "Monthly contribution as a % of your income" },
  { key: "shareSavingsRate", label: "Savings rate", hint: "(income − expense) / income" },
  { key: "shareEmergencyBuffer", label: "Emergency buffer", hint: "How many months of expenses your wallet covers" },
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

  function toggleShare(key: keyof SharingSettings, value: boolean) {
    // Optimistic: flip it now, and let the reload reconcile if the save fails.
    setOverview((prev) => (prev ? { ...prev, sharing: { ...prev.sharing, [key]: value } } : prev));
    run(() => apiFetch("/friends/settings", { method: "PUT", body: { [key]: value } }));
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
    <ScrollView contentContainerStyle={styles.scrollContainer}>
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
        <Text style={styles.hint}>Everything is off until you turn it on. You always see your own stats.</Text>
        {SHARE_OPTIONS.map((opt) => (
          <View key={opt.key} style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>{opt.label}</Text>
              <Text style={styles.hint}>{opt.hint}</Text>
            </View>
            <Switch
              value={overview.sharing[opt.key]}
              onValueChange={(v) => toggleShare(opt.key, v)}
              trackColor={{ true: "#2e6fdb", false: "#ccc" }}
            />
          </View>
        ))}
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
        {overview.friends.map((f) => (
          <View key={f.friendshipId} style={styles.personRow}>
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
    </ScrollView>
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
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
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
