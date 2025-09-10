// apps/mobile/src/ui/Section.tsx
import React from "react";
import { View, Text, ViewStyle } from "react-native";
import { useTheme } from "./ThemeProvider";

export function Section({
  label,
  children,
  style,
}: {
  label?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.card,
          marginHorizontal: 12,
          marginBottom: 12,
          borderRadius: t.radius,
          padding: 16,
          borderColor: t.border,
          borderWidth: 1,
        },
        t.shadowStyle as any,
        style,
      ]}
    >
      {!!label && (
        <Text style={{ fontSize: 12, color: t.textMuted, letterSpacing: 1.2, marginBottom: 6 }}>
          {label.toUpperCase()}
        </Text>
      )}
      {children}
    </View>
  );
}
