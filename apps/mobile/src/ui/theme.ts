// apps/mobile/src/ui/theme.ts
export type ThemeTokens = {
  bg: string;
  card: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  danger: string;
  success: string;
  radius: number;
  spacing: (n?: number) => number;
  shadowStyle: object;
  isNonProd: boolean;
};

const base = {
  radius: 12,
  spacing: (n = 1) => n * 8,
  shadowStyle: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
};

const prod: ThemeTokens = {
  bg: "#F6F7F9",
  card: "#FFFFFF",
  text: "#0F172A",
  textMuted: "#64748B",
  border: "#E5E7EB",
  primary: "#2563EB",
  danger: "#DC2626",
  success: "#16A34A",
  isNonProd: false,
  ...base,
};

const nonprod: ThemeTokens = {
  ...prod,
  // subtle differences + a more visible primary
  primary: "#7C3AED", // purple accent for nonprod
  isNonProd: true,
};

export function getEnv(): "prod" | "nonprod" {
  const v = String(process.env.EXPO_PUBLIC_ENV || "").toLowerCase();
  return v === "prod" ? "prod" : "nonprod";
}

export function getTheme(): ThemeTokens {
  return getEnv() === "prod" ? prod : nonprod;
}
