/**
 * Invest — the tab that brought the Funds and Portfolios tabs together (DECISIONS.md #30). A segmented control at
 * the top picks the view, as on the Peers tab:
 *  - "Managed": the ready-made portfolios by risk level, each with a page to read and buy from (S-03);
 *  - "Discover": every fund in the catalog, to browse and open;
 *  - "Custom": your own mixes, and a form to build one from the funds you pick and the weights you set.
 *
 * Other screens open it on a particular view with the `tab` route param, e.g. a "Buy a portfolio" link opens
 * Managed and "Choose a fund" opens Discover.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MainTabScreenProps } from "../navigation/AppNavigator";
import { InvestTab, INVEST_TABS } from "../utils/investTabs";
import { CustomPortfolios } from "./CustomPortfolios";
import { DiscoverFunds } from "./DiscoverFunds";
import { ManagedPortfolios } from "./ManagedPortfolios";

type Props = MainTabScreenProps<"Invest">;

export function InvestScreen({ route }: Props) {
  const [tab, setTab] = useState<InvestTab>(route.params?.tab ?? "managed");

  // A link from another screen asks for a view: each navigation carries a fresh params object.
  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params]);

  return (
    <View style={styles.screen}>
      <View style={styles.segmentRow}>
        {INVEST_TABS.map((t) => (
          <Pressable
            key={t.value}
            style={[styles.segment, tab === t.value && styles.segmentSelected]}
            onPress={() => setTab(t.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t.value }}
            accessibilityLabel={`${t.label} view`}
          >
            <Text style={[styles.segmentText, tab === t.value && styles.segmentTextSelected]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "managed" ? <ManagedPortfolios onSelectTab={setTab} /> : tab === "discover" ? <DiscoverFunds onSelectTab={setTab} /> : <CustomPortfolios />}
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
