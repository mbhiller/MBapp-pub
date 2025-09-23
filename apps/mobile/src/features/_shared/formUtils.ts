// Always provide a stable string for TextInput values
export const toStr = (v: unknown): string => (v == null ? "" : String(v));

// Simple string field hook: keeps a controlled string and stable setter
import * as React from "react";
export function useStringField(initial: unknown) {
  const [value, setValue] = React.useState<string>(toStr(initial));
  const onChangeText = React.useCallback((s: string) => setValue(s ?? ""), []);
  return [value, onChangeText, setValue] as const;
}
