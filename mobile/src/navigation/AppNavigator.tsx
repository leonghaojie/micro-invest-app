/**
 * AppNavigator — the dialog map (Phase 1 Analysis §4) implemented as a
 * React Navigation native stack. Screen order mirrors the SRS §7.1 screen
 * list and the main success scenarios in SRS §6 (UC-01 → UC-06).
 *
 * S-01 Welcome/Login → S-02 Profile Setup (first-time) → S-03 Simulation
 * Setup → S-04 Dashboard → S-05 Peer Comparison / S-06 Insights.
 *
 * Auth-gating (skip S-01/S-02 for returning, already-onboarded users) is a
 * Phase 3 concern once AuthService/ProfileService exist — the skeleton
 * wires every screen into one stack rather than guessing that logic early.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { DashboardScreen } from "../screens/DashboardScreen";
import { InsightsScreen } from "../screens/InsightsScreen";
import { PeerComparisonScreen } from "../screens/PeerComparisonScreen";
import { ProfileSetupScreen } from "../screens/ProfileSetupScreen";
import { SimulationSetupScreen } from "../screens/SimulationSetupScreen";
import { WelcomeLoginScreen } from "../screens/WelcomeLoginScreen";

export type RootStackParamList = {
  WelcomeLogin: undefined;
  ProfileSetup: undefined;
  SimulationSetup: undefined;
  Dashboard: undefined;
  PeerComparison: undefined;
  Insights: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator initialRouteName="WelcomeLogin">
      <Stack.Screen name="WelcomeLogin" component={WelcomeLoginScreen} options={{ title: "Welcome" }} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ title: "Set Up Profile" }} />
      <Stack.Screen name="SimulationSetup" component={SimulationSetupScreen} options={{ title: "Simulate" }} />
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="PeerComparison" component={PeerComparisonScreen} options={{ title: "Peer Comparison" }} />
      <Stack.Screen name="Insights" component={InsightsScreen} options={{ title: "Insights" }} />
    </Stack.Navigator>
  );
}
