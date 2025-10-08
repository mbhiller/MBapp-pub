// apps/mobile/src/ui/theme.ts

export type Theme = {
  colors: {
    bg: string;
    card: string;
    border: string;
    text: string;
    textMuted: string;
    primary: string;
    danger: string;
    success: string;
    headerBg: string;
    headerText: string;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    pill: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
  };
};

export const defaultTheme: Theme = {
  colors: {
    // Matches your existing look from the originals
    bg: "#ffffff",
    card: "#eeeeee",
    border: "#cccccc",
    text: "#111111",
    textMuted: "#666666",
    primary: "#007aff",
    danger: "crimson",
    success: "#B6A268",
    headerBg: "#ffffff",
    headerText: "#111111",
  },
  radius: { sm: 6, md: 8, lg: 12, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 14, lg: 18 },
};
