import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Hub">;

type ModuleKey = "products" | "objects" | "tenants";
type ModuleDef = {
  key: ModuleKey;
  title: string;
  screen: keyof RootStackParamList;
};

const MODULES: ModuleDef[] = [
  { key: "products", title: "Products", screen: "ProductsList" },
  { key: "objects", title: "Objects", screen: "ObjectsList" },
  { key: "tenants", title: "Tenants", screen: "Tenants" },
];

export default function ModuleHubScreen({ navigation }: Props) {
  return (
    <View style={s.container}>
      <Text style={s.h1}>Hub</Text>
      <View style={s.grid}>
        {MODULES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={s.tile}
            onPress={() => navigation.navigate(m.screen as any)}
          >
            <Text style={s.tileText}>{m.title}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[s.tile, s.util]}
          onPress={() => navigation.navigate("Scan")}
        >
          <Text style={s.tileText}>Scan</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    width: "46%",
    minHeight: 90,
    borderRadius: 12,
    padding: 16,
    backgroundColor: "#eee",
    justifyContent: "center",
  },
  util: { backgroundColor: "#ddd" },
  tileText: { fontSize: 16, fontWeight: "600" },
});
