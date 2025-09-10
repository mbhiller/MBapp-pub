// apps/mobile/src/ui/NonProdBadge.tsx
import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "./ThemeProvider";

export function NonProdBadge() {
  const t = useTheme();
  if (!t.isNonProd) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        backgroundColor: t.primary,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>NON-PROD</Text>
    </View>
  );
}
