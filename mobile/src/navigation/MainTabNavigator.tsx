/**
 * MainTabNavigator — the bottom tab bar (see AppNavigator.tsx header for
 * the restructuring this is part of). Four sibling tabs; a compact
 * icon+label bar, not a full-page nav — same idea as any standard mobile
 * app bottom bar (Home / Quotes / Portfolio / … style), just four entries
 * scoped to what this app actually does.
 */
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import type { RouteProp } from "@react-navigation/native";
import { DashboardScreen } from "../screens/DashboardScreen";
import { InsightsScreen } from "../screens/InsightsScreen";
import { InvestScreen } from "../screens/InvestScreen";
import { PeerComparisonScreen } from "../screens/PeerComparisonScreen";
import type { MainTabParamList } from "./AppNavigator";

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS: Record<keyof MainTabParamList, { focused: keyof typeof Ionicons.glyphMap; unfocused: keyof typeof Ionicons.glyphMap }> = {
  Dashboard: { focused: "home", unfocused: "home-outline" },
  Invest: { focused: "trending-up", unfocused: "trending-up-outline" },
  PeerComparison: { focused: "bar-chart", unfocused: "bar-chart-outline" },
  Insights: { focused: "bulb", unfocused: "bulb-outline" },
};

function screenOptions({ route }: { route: RouteProp<MainTabParamList, keyof MainTabParamList> }): BottomTabNavigationOptions {
  return {
    tabBarActiveTintColor: "#2e6fdb",
    tabBarInactiveTintColor: "#8a8a8a",
    tabBarIcon: ({ focused, color, size }) => {
      const icon = ICONS[route.name];
      return <Ionicons name={focused ? icon.focused : icon.unfocused} size={size} color={color} />;
    },
  };
}

export function MainTabNavigator() {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Tab.Screen name="Invest" component={InvestScreen} options={{ title: "Invest" }} />
      <Tab.Screen name="PeerComparison" component={PeerComparisonScreen} options={{ title: "Peers" }} />
      <Tab.Screen name="Insights" component={InsightsScreen} options={{ title: "Insights" }} />
    </Tab.Navigator>
  );
}
