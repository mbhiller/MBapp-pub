// Minimal theme tokens + hook

export type Theme = {
  bg: string;
  card: string;
  text: string;
  textMuted: string;
  tint: string;
  border: string;
};

export const lightTheme: Theme = {
  bg: "#f7f7f7",
  card: "#ffffff",
  text: "#111111",
  textMuted: "#666666",
  tint: "#3478f6",
  border: "#e6e6e6",
};

export const darkTheme: Theme = {
  bg: "#0b0b0b",
  card: "#161616",
  text: "#f2f2f2",
  textMuted: "#a1a1a1",
  tint: "#4da3ff",
  border: "#242424",
};
