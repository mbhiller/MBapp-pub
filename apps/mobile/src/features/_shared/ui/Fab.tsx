// apps/mobile/src/ui/Fab.tsx
import React from "react";
import { Text, TouchableOpacity, ViewStyle } from "react-native";
import { useTheme } from "../providers/ThemeProvider";

export function Fab({ label, onPress, style }: { label: string; onPress: () => void; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        {
          position: "absolute",
          right: 16,
          bottom: 24,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: t.radius.pill,
          backgroundColor: t.colors.primary,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 4,
          elevation: 3,
        },
        style,
      ]}
    >
      <Text style={{ color: t.colors.headerText, fontWeight: "700" }}>{label}</Text>
    </TouchableOpacity>
  );
}
