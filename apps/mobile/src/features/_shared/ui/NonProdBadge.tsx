import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../providers/ThemeProvider";

export function NonProdBadge() {
  const t = useTheme();
  const tenant = process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";
  return (
    <View
      style={{
        backgroundColor: t.colors.card,
        borderColor: t.colors.border,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 12 }}>{tenant}</Text>
    </View>
  );
}
