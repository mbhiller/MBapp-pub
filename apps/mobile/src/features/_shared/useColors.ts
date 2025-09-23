// apps/mobile/src/features/_shared/useColors.ts
import { useTheme } from "../../providers/ThemeProvider";

export function useColors() {
  const t = useTheme();
  const base = t.colors;
  return {
    colors: {
      ...base,
      background: base.bg,         // expected by screens
      muted: base.textMuted,
      disabled: base.border,
      buttonText: base.headerText,
      buttontext: base.headerText, // tolerate casing variants
    },
  };
}
