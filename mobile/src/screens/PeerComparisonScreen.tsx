/**
 * S-05 Peer Comparison — UC-05. A segmented control at the top picks the
 * comparison (DECISIONS.md #8, #9, #18):
 *  - "Cohort" (default): you against investors chosen to be like you for each
 *    metric, with the reason for the comparison stated (PeerCohort, NFR-03);
 *  - "Explore": the anonymous, aggregate-only dashboard where you choose what
 *    "peers" means (PeerDashboard — distribution, trajectory, allocation);
 *  - "Friends": a consent-based ranking among people the user added
 *    (FriendsComparison — the one place named individuals appear).
 *
 * History: this screen began as three fixed p25/p50/p75 bars against one
 * income-range definition of "peers" (DECISIONS.md #2). The richer views
 * (#9) replaced those bars; the segmentation controls let the user choose
 * what "peers" means.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MainTabScreenProps } from "../navigation/AppNavigator";
import { FriendsComparison } from "./FriendsComparison";
import { PeerCohort } from "./PeerCohort";
import { PeerDashboard } from "./PeerDashboard";

type Props = MainTabScreenProps<"PeerComparison">;

type Mode = "cohort" | "explore" | "friends";

const MODES: { value: Mode; label: string }[] = [
  { value: "cohort", label: "Cohort" },
  { value: "explore", label: "Explore" },
  { value: "friends", label: "Friends" },
];

export function PeerComparisonScreen({ navigation }: Props) {
  const [mode, setMode] = useState<Mode>("cohort");

  return (
    <View style={styles.screen}>
      <View style={styles.segmentRow}>
        {MODES.map((m) => (
          <Pressable
            key={m.value}
            style={[styles.segment, mode === m.value && styles.segmentSelected]}
            onPress={() => setMode(m.value)}
          >
            <Text style={[styles.segmentText, mode === m.value && styles.segmentTextSelected]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "cohort" ? (
        <PeerCohort onStartPlan={() => navigation.navigate("Invest", { tab: "managed" })} onEditProfile={() => navigation.navigate("ProfileSetup")} />
      ) : mode === "explore" ? (
        <PeerDashboard onStartPlan={() => navigation.navigate("Invest", { tab: "managed" })} />
      ) : (
        <FriendsComparison onManage={() => navigation.navigate("Friends")} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  segmentRow: {
    flexDirection: "row",
    alignSelf: "center",
    width: "100%",
    maxWidth: 360,
    marginTop: 16,
    marginHorizontal: 24,
    borderWidth: 1,
    borderColor: "#2e6fdb",
    borderRadius: 8,
    overflow: "hidden",
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: "#fff" },
  segmentSelected: { backgroundColor: "#2e6fdb" },
  segmentText: { color: "#2e6fdb", fontWeight: "600" },
  segmentTextSelected: { color: "#fff" },
});
