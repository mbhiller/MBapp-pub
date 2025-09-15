import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";
import type { ViewStyle, TextStyle } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "Hub">;

type ModuleKey = "products" | "events" | "objects" | "tenants";
type ModuleDef = {
  key: ModuleKey;
  title: string;
  screen: keyof RootStackParamList;
};

const MODULES: ModuleDef[] = [
  { key: "products", title: "Products", screen: "ProductsList" },
  { key: "events",   title: "Events",   screen: "EventsList" },
  { key: "objects",  title: "Objects",  screen: "ObjectsList" },
  { key: "tenants",  title: "Tenants",  screen: "Tenants" },
];

export default function ModuleHubScreen({ navigation }: Props) {
  const t = useTheme();

  return (
    <View style={sx.container(t)}>
      <Text style={sx.h1(t)}>Hub</Text>

      {/* grid container */}
      <View style={sx.grid(t)}>
        {MODULES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={sx.tile(t)}
            onPress={() => navigation.navigate(m.screen as any)}
          >
            <Text style={sx.tileText(t)}>{m.title}</Text>
          </TouchableOpacity>
        ))}

        {/* Utility tile */}
        <TouchableOpacity style={sx.tile(t)} onPress={() => navigation.navigate("Scan")}>
          <Text style={sx.tileText(t)}>Scan</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const sx = {
  container: (t: ReturnType<typeof useTheme>): ViewStyle => ({
    flex: 1,
    padding: 16,
    backgroundColor: t.colors.bg,
  }),
  h1: (t: ReturnType<typeof useTheme>): TextStyle => ({
    fontSize: 22,
    fontWeight: "700" as TextStyle["fontWeight"],
    marginBottom: 12,
    color: t.colors.text,
  }),
  // simple 2-column wrap grid
  grid: (_t: ReturnType<typeof useTheme>): ViewStyle => ({
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  }),
  tile: (t: ReturnType<typeof useTheme>): ViewStyle => ({
    width: "48%",
    minHeight: 90,
    borderRadius: 12,
    padding: 16,
    backgroundColor: t.colors.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    justifyContent: "center",
    marginBottom: 12,
  }),
  tileText: (t: ReturnType<typeof useTheme>): TextStyle => ({
    fontSize: 16,
    fontWeight: "600" as TextStyle["fontWeight"],
    color: t.colors.text,
  }),
};
