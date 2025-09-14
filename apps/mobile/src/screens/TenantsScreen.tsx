import React from "react";
import { View } from "react-native";
import { Text, useTheme } from "react-native-paper";

export default function TenantsScreen() {
  const theme = useTheme();
  const tenant = process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant";
  return (
    <View style={{ padding: 16 }}>
      <Text variant="titleMedium" style={{ marginBottom: 6, color: theme.colors.onBackground }}>
        Current Tenant
      </Text>
      <Text variant="bodyLarge">{tenant}</Text>
    </View>
  );
}
