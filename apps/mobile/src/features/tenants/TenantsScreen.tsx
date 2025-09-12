import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { RootStackScreenProps } from "../../navigation/types";

type Props = RootStackScreenProps<"Tenants">;

export default function TenantsScreen(_props: Props) {
  // Minimal safe screen; wire up your tenants hook/list later.
  return (
    <View style={s.container}>
      <Text style={s.h1}>Tenants</Text>
      <Text>Coming soon (list + select).</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
});
