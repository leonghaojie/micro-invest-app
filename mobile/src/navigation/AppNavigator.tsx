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
 * Auto-login: a stored JWT (mobile/src/api/client.ts) is verified against
 * the server (GET /auth/me) on boot. Only if the server confirms it do we
 * assume an already-onboarded returning user (the same assumption
 * WelcomeLoginScreen's own login path already made) and open straight on
 * Main; a missing, expired or orphaned token lands on the login screen.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { apiFetch, ApiError, clearStoredAuthToken, getStoredAuthToken, setUnauthorizedHandler } from "../api/client";
import { FriendHoldingsScreen } from "../screens/FriendHoldingsScreen";
import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen";
import { FriendsScreen } from "../screens/FriendsScreen";
import { ProfileSetupScreen } from "../screens/ProfileSetupScreen";
import { WelcomeLoginScreen } from "../screens/WelcomeLoginScreen";
import { MainTabNavigator } from "./MainTabNavigator";
import { navigationRef } from "./navigationRef";

export type MainTabParamList = {
  Dashboard: undefined;
  Funds: undefined;
  Contribution: undefined;
  PeerComparison: undefined;
  Insights: undefined;
};

export type RootStackParamList = {
  // passwordResetDone: set by ForgotPasswordScreen so the login screen can confirm the reset.
  WelcomeLogin: { passwordResetDone?: boolean } | undefined;
  // DECISIONS.md #10: emailed-code password reset, reached from the login screen.
  ForgotPassword: { email?: string } | undefined;
  ProfileSetup: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  // DECISIONS.md #8: friend management, opened from the Peers tab.
  Friends: undefined;
  // DECISIONS.md #12: one person's full holdings. friendshipId is a friendship
  // handle (never a user id), or "me" for the viewer's own.
  FriendHoldings: { friendshipId: string; displayName: string };
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
    // A stored token only skips the login screen if the server confirms it
    // still belongs to a real account. A token left over from an old session,
    // an expired one, or one whose user no longer exists (e.g. after a database
    // reset) is discarded. If the server can't be reached we can't verify, so
    // we show the login screen rather than the dashboard.
    async function checkSession() {
      const token = await getStoredAuthToken();
      if (!token) return "WelcomeLogin" as const;
      try {
        await apiFetch("/auth/me");
        return "Main" as const;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) await clearStoredAuthToken();
        return "WelcomeLogin" as const;
      }
    }
    checkSession().then((route) => {
      if (!cancelled) setInitialRoute(route);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mid-session: if any authenticated request later comes back 401 (token
  // expired, account removed), the API client clears the token and we land on
  // the login screen instead of leaving a broken dashboard on screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (navigationRef.isReady()) {
        navigationRef.reset({ index: 0, routes: [{ name: "WelcomeLogin" }] });
      }
    });
    return () => setUnauthorizedHandler(null);
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
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Reset Password" }} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ title: "Set Up Profile" }} />
      <Stack.Screen name="Main" component={MainTabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: "Friends" }} />
      <Stack.Screen
        name="FriendHoldings"
        component={FriendHoldingsScreen}
        options={({ route }) => ({ title: `${route.params.displayName}'s holdings` })}
      />
    </Stack.Navigator>
  );
}
