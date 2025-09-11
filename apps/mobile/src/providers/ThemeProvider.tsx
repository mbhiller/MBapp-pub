import React, { createContext, useContext, useMemo, useState } from "react";
import { ColorSchemeName, useColorScheme } from "react-native";

type Mode = "light" | "dark";

type Colors = {
  bg: string;
  card: string;
  text: string;
  textMuted: string;
  border: string;
  headerBg: string;
  headerText: string;
  primary: string;
  success: string;
  danger: string;
};

type Theme = {
  mode: Mode;
  colors: Colors;
  toggleTheme(): void;
  // Back-compat flat aliases (so old code like t.text keeps working)
  text: string;
  textMuted: string;
  primary: string;
};

const ThemeCtx = createContext<Theme | undefined>(undefined);

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const system: ColorSchemeName = useColorScheme();
  const [mode, setMode] = useState<Mode>((system as Mode) || "light");

  const colors: Colors = useMemo(() => {
    if (mode === "dark") {
      return {
        bg: "#0b0b0d",
        card: "#17171a",
        text: "#f5f5f7",
        textMuted: "#bdbdc2",
        border: "#2a2a2e",
        headerBg: "#111114",
        headerText: "#f5f5f7",
        primary: "#4a86ff",
        success: "#53b27f",
        danger: "#ff5a5f",
      };
    }
    return {
      bg: "#f7f7f7",
      card: "#ffffff",
      text: "#111",
      textMuted: "#555",
      border: "#eee",
      headerBg: "#fff",
      headerText: "#111",
      primary: "#3478f6",
      success: "#2a8b57",
      danger: "crimson",
    };
  }, [mode]);

  const value: Theme = {
    mode,
    colors,
    toggleTheme() { setMode(m => (m === "light" ? "dark" : "light")); },
    // aliases
    text: colors.text,
    textMuted: colors.textMuted,
    primary: colors.primary,
  };

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
};

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
