/**
 * Lets code outside a screen (the API client's 401 handler) navigate.
 * Passed to <NavigationContainer ref=...> in App.tsx.
 */
import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./AppNavigator";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
