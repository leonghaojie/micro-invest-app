/**
 * AppNavigator — root navigator.
 *
 * UI restructuring (20 Aug 2026): the app used to be one long native-stack
 * flow, screen after screen (S-01 → S-02 → S-03 → S-04 → S-05/S-06), each
 * screen pushing/replacing the next. That's now split in two:
 *
 *   RootStack — WelcomeLogin (S-01) → ProfileSetup (S-02, first-time only)
 *   → Main, a single stack screen that hosts the whole tab bar below.
 *
 *   MainTabNavigator (./MainTabNavigator.tsx) — Dashboard (S-04), Funds
 *   (new — fund catalog browsing + portfolio building, split out of what
 *   used to be S-03's "build" step), Contribution (S-03, trimmed to just
 *   choose-a-portfolio + configure-and-run), Peer Comparison (S-05),
 *   Insights (S-06) — five sibling tabs a user jumps between directly,
 *   instead of a fixed linear order.
 *
 * Auto-login: a stored JWT (mobile/src/api/client.ts) is checked once on
 * boot; if present we assume an already-onboarded returning user (the
 * same assumption WelcomeLoginScreen's own login path already made) and
 * open straight on Main rather than making them re-enter credentials
 * every launch.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { getStoredAuthToken } from "../api/client";
import { ProfileSetupScreen } from "../screens/ProfileSetupScreen";
import { WelcomeLoginScreen } from "../screens/WelcomeLoginScreen";
import { MainTabNavigator } from "./MainTabNavigator";

export type MainTabParamList = {
  Dashboard: undefined;
  Funds: undefined;
  Contribution: undefined;
  PeerComparison: undefined;
  Insights: undefined;
};

export type RootStackParamList = {
  WelcomeLogin: undefined;
  ProfileSetup: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
};

// Props helper for the two pre-login stack screens.
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

// Props helper for screens living inside a tab: composes the tab's own nav
// (for jumping to a sibling tab, e.g. Contribution -> Dashboard) with the
// root stack's (for navigation.getParent() actions like logging out).
export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  const [initialRoute, setInitialRoute] = useState<"WelcomeLogin" | "Main" | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStoredAuthToken().then((token) => {
      if (!cancelled) setInitialRoute(token ? "Main" : "WelcomeLogin");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the auto-login check before the navigator ever mounts, rather
  // than mounting at a fixed route and redirecting — avoids a visible
  // flash of the login screen for a returning user.
  if (initialRoute === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack.Navigator initialRouteName={initialRoute}>
      <Stack.Screen name="WelcomeLogin" component={WelcomeLoginScreen} options={{ title: "Welcome" }} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ title: "Set Up Profile" }} />
      <Stack.Screen name="Main" component={MainTabNavigator} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
