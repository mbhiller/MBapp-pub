// apps/mobile/src/features/_shared/ui/theme.ts

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
    primaryText: string; // text on primary buttons
    inputBg: string;     // text input background
    badgeReservedBg?: string;  badgeReservedFg?: string;
    badgeFulfilledBg?: string; badgeFulfilledFg?: string;
    badgeBackorderedBg?: string; badgeBackorderedFg?: string;
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
    primaryText: "#ffffff",
    inputBg: "#ffffff",
    badgeReservedBg: "#EEF2FF",   badgeReservedFg: "#3730A3",
    badgeFulfilledBg: "#ECFDF5",  badgeFulfilledFg: "#065F46",
    badgeBackorderedBg: "#FEF3C7",badgeBackorderedFg: "#92400E",
  },
  radius: { sm: 6, md: 8, lg: 12, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 14, lg: 18 },
};
