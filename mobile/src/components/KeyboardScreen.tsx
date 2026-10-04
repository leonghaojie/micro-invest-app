/**
 * KeyboardScreen — the scrolling container for any screen with text inputs.
 *
 * Without it, the on-screen keyboard covers the bottom half of the screen and
 * hides the field being typed into, and a fixed (non-scrolling) layout gives
 * the user no way to reach it. This wraps content so that:
 *  - the page scrolls (also when content is short, via flexGrow, so centred
 *    forms stay centred);
 *  - the focused field is kept in view while the keyboard is open:
 *      iOS      — ScrollView.automaticallyAdjustKeyboardInsets pads the scroll
 *                 area by the keyboard height and scrolls to the focused input;
 *      Android  — Expo apps are edge-to-edge, so the window no longer resizes
 *                 for the keyboard; KeyboardAvoidingView("padding") shrinks the
 *                 scroll view instead, and the native ScrollView brings the
 *                 focused input into view;
 *  - tapping a button while the keyboard is open works on the first tap
 *    (keyboardShouldPersistTaps="handled"), and dragging the page dismisses it.
 *
 * Pass the screen's layout as `contentContainerStyle`. Use `flexGrow: 1`, not
 * `flex: 1`, there: flex: 1 would pin the content to the viewport height and
 * stop it scrolling.
 */
import { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, ScrollViewProps, StyleSheet } from "react-native";

interface Props extends Omit<ScrollViewProps, "children"> {
  children: ReactNode;
}

export function KeyboardScreen({ children, contentContainerStyle, ...scrollProps }: Props) {
  const scroll = (
    <ScrollView
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      {...scrollProps}
    >
      {children}
    </ScrollView>
  );

  // Web (the Expo preview) and iOS don't need the wrapper; see the header.
  if (Platform.OS !== "android") return scroll;

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      {scroll}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
