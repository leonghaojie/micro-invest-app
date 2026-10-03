/**
 * SVG <text> on web doesn't inherit the app's font and falls back to the
 * browser's serif default, which looks out of place next to the rest of the
 * UI. On web, point it at the system sans stack; on native, leave it unset
 * (native text already uses the platform's system font, and a CSS-style
 * font stack isn't valid there).
 */
import { Platform } from "react-native";

export const SVG_FONT_FAMILY: string | undefined = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});
