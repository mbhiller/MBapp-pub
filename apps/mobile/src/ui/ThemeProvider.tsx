// apps/mobile/src/ui/ThemeProvider.tsx
import React, { createContext, useContext, useMemo } from "react";
import { getTheme, type ThemeTokens } from "./theme";

const ThemeCtx = createContext<ThemeTokens | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const tokens = useMemo(() => getTheme(), []);
  return <ThemeCtx.Provider value={tokens}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeTokens {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
