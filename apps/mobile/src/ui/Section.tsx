import React, { PropsWithChildren } from "react";
import { View, Text, ViewStyle } from "react-native";
import { useTheme } from "../providers/ThemeProvider";

type Props = PropsWithChildren<{
  label?: string;
  style?: ViewStyle | ViewStyle[];
}>;

export function Section({ label, children, style }: Props) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? (
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 6 }}>{label}</Text>
      ) : null}
      <View
        style={[
          {
            backgroundColor: t.colors.card,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.colors.border,
            padding: 12
          },
          style as any
        ]}
      >
        {children}
      </View>
    </View>
  );
}
