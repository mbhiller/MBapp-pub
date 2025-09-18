import React from "react";
import { View, Text } from "react-native";
import { useColors } from "../providers/useColors";

export default function TenantsScreen() {
  const t = useColors();
  const tenant = process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant";
  return (
    <View style={{ padding: 16, backgroundColor: t.colors.bg, flex: 1 }}>
      <Text style={{ color: t.colors.muted, fontSize: 16, marginBottom: 6 }}>Current Tenant</Text>
      <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>{tenant}</Text>
    </View>
  );
}
