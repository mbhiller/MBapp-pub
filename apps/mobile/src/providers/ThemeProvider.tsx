import React, { createContext, useContext, useMemo } from "react";
import { defaultTheme, type Theme } from "../features/_shared/ui/theme";

const ThemeCtx = createContext<Theme>(defaultTheme);

export function ThemeProvider({ children, value }: { children: React.ReactNode; value?: Partial<Theme> }) {
  const merged = useMemo<Theme>(() => ({
    ...defaultTheme,
    ...(value || {}),
    colors: { ...defaultTheme.colors, ...(value?.colors || {}) },
    radius: { ...defaultTheme.radius, ...(value?.radius || {}) },
    spacing: { ...defaultTheme.spacing, ...(value?.spacing || {}) },
  }), [value]);
  return <ThemeCtx.Provider value={merged}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}
