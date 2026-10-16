/**
 * lib/themeContext.tsx
 *
 * @deprecated Use `@/lib/theme` directly.
 *
 * This file is a thin re-export shim kept only for backwards-compatibility
 * while any legacy imports are migrated. It re-exports every public symbol
 * from the canonical three-state theme module so existing `import { … }
 * from "@/lib/themeContext"` statements continue to compile without error.
 *
 * Do NOT add new code here. Update your import path to `@/lib/theme` and
 * remove this file once all consumers have been migrated.
 */

export {
  ThemeProvider,
  useTheme,
  applyThemeToDocument,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type EffectiveTheme,
} from "@/lib/theme";
