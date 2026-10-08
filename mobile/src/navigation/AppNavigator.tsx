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
 *   MainTabNavigator (./MainTabNavigator.tsx) — Dashboard (S-04), Invest
 *   (S-03: Managed portfolios, Discover funds and Custom portfolios in one
 *   tab, DECISIONS.md #30; it replaced the separate Funds and Portfolios
 *   tabs), Peer Comparison (S-05), Insights (S-06) — four sibling tabs a
 *   user jumps between directly, instead of a fixed linear order.
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
import { EditAccountScreen } from "../screens/EditAccountScreen";
import { FriendCompareScreen } from "../screens/FriendCompareScreen";
import { FundDetailScreen } from "../screens/FundDetailScreen";
import { PortfolioDetailScreen } from "../screens/PortfolioDetailScreen";
import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen";
import { FriendsScreen } from "../screens/FriendsScreen";
import { ActivityScreen } from "../screens/ActivityScreen";
import { CheckInScreen } from "../screens/CheckInScreen";
import { ProfileSetupScreen } from "../screens/ProfileSetupScreen";
import { RecurringScreen } from "../screens/RecurringScreen";
import { TradeScreen } from "../screens/TradeScreen";
import { WelcomeLoginScreen } from "../screens/WelcomeLoginScreen";
import { MainTabNavigator } from "./MainTabNavigator";
import { navigationRef } from "./navigationRef";
import type { InvestTab } from "../utils/investTabs";

export type MainTabParamList = {
  Dashboard: undefined;
  // DECISIONS.md #30: Funds and Portfolios in one tab; `tab` opens a particular view (managed, discover, custom).
  Invest: { tab?: InvestTab } | undefined;
  PeerComparison: undefined;
  Insights: undefined;
};

export type RootStackParamList = {
  // passwordResetDone: set by ForgotPasswordScreen so the login screen can confirm the reset.
  WelcomeLogin: { passwordResetDone?: boolean } | undefined;
  // DECISIONS.md #10: emailed-code password reset, reached from the login screen.
  ForgotPassword: { email?: string } | undefined;
  ProfileSetup: undefined;
  // DECISIONS.md #19: the same form, to change income, expenses, risk... later in life.
  EditProfile: undefined;
  // DECISIONS.md #19: buy or sell. Exactly one of fundId / portfolioId for a buy; fundId for a sell.
  Trade: { mode: "buy" | "sell"; name: string; fundId?: string; portfolioId?: string; monthly?: boolean };
  // DECISIONS.md #19: monthly buys: set up, change the amount, pause, resume.
  Recurring: undefined;
  // DECISIONS.md #19: buys, sells and monthly cash credits.
  Activity: undefined;
  // DECISIONS.md #31: the monthly check-in of income and spending.
  CheckIn: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  // DECISIONS.md #8: friend management, opened from the Peers tab.
  Friends: undefined;
  // DECISIONS.md #12: one person's full holdings. friendshipId is a friendship
  // handle (never a user id), or "me" for the viewer's own.
  FriendCompare: { friendshipId: string; displayName: string };
  // DECISIONS.md #14: one fund's history and statistics, opened from the Invest tab.
  FundDetail: { fundId: string; ticker: string };
  PortfolioDetail: { portfolioId: string; name: string };
  // DECISIONS.md #17: change one account detail, opened from the dashboard's Account section.
  EditAccount: { kind: "name" | "email" | "password" };
};

// Props helper for the two pre-login stack screens.
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

// Props helper for screens living inside a tab: composes the tab's own nav
// (for jumping to a sibling tab, e.g. Invest -> Dashboard) with the
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
      <Stack.Screen name="EditProfile" component={ProfileSetupScreen} options={{ title: "Edit Profile" }} />
      <Stack.Screen name="Main" component={MainTabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Trade" component={TradeScreen} options={({ route }) => ({ title: route.params.mode === "buy" ? "Buy" : "Sell" })} />
      <Stack.Screen name="Activity" component={ActivityScreen} options={{ title: "Activity" }} />
      <Stack.Screen name="CheckIn" component={CheckInScreen} options={{ title: "Monthly check-in" }} />
      <Stack.Screen name="Recurring" component={RecurringScreen} options={{ title: "Monthly buys" }} />
      <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: "Friends" }} />
      <Stack.Screen
        name="FriendCompare"
        component={FriendCompareScreen}
        options={({ route }) => ({ title: `You and ${route.params.displayName}` })}
      />
      <Stack.Screen
        name="EditAccount"
        component={EditAccountScreen}
        options={({ route }) => ({ title: { name: "Display name", email: "Change email", password: "Change password" }[route.params.kind] })}
      />
      <Stack.Screen name="FundDetail" component={FundDetailScreen} options={({ route }) => ({ title: route.params.ticker })} />
      <Stack.Screen name="PortfolioDetail" component={PortfolioDetailScreen} options={({ route }) => ({ title: route.params.name })} />
    </Stack.Navigator>
  );
}
