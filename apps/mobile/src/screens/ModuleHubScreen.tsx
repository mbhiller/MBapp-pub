// apps/mobile/src/screens/ModuleHubScreen.tsx
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useColors } from "../providers/useColors";
import { useRoles } from "../providers/RolesProvider";
import { MODULES } from "../shared/modules"; // see modules.ts drop-in below
import type { ViewStyle, TextStyle } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "Hub">;

export default function ModuleHubScreen({ navigation }: Props) {
  const t = useColors();
  const { allowedModules } = useRoles();

  const tiles = MODULES.filter((m) => allowedModules.some((am) => am.key === m.key));

  return (
    <View style={sx.container(t)}>
      <Text style={sx.h1(t)}>Hub</Text>

      <View style={sx.grid(t)}>
        {tiles.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={sx.tile(t)}
            onPress={() => navigation.navigate(m.screen as any)}
          >
            <Text style={sx.tileText(t)}>{m.title}</Text>
          </TouchableOpacity>
        ))}

        {/* Utility: Scan is always available */}
        <TouchableOpacity style={sx.tile(t)} onPress={() => navigation.navigate("Scan")}>
          <Text style={sx.tileText(t)}>Scan</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const sx = {
  container: (t: ReturnType<typeof useColors>): ViewStyle => ({
    flex: 1,
    padding: 16,
    backgroundColor: t.colors.bg,
  }),
  h1: (t: ReturnType<typeof useColors>): TextStyle => ({
    fontSize: 22,
    fontWeight: "700" as TextStyle["fontWeight"],
    marginBottom: 12,
    color: t.colors.text,
  }),
  grid: (_t: ReturnType<typeof useColors>): ViewStyle => ({
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  }),
  tile: (t: ReturnType<typeof useColors>): ViewStyle => ({
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
  tileText: (t: ReturnType<typeof useColors>): TextStyle => ({
    fontSize: 16,
    fontWeight: "600" as TextStyle["fontWeight"],
    color: t.colors.text,
  }),
};
