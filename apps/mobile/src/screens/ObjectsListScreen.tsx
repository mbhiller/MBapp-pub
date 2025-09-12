import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";

type Props = RootStackScreenProps<"ObjectsList">;

export default function ObjectsListScreen({ navigation }: Props) {
  // Minimal safe list with one demo row that navigates to ObjectDetail
  const demo = { id: "demo-123", type: "horse" };

  return (
    <View style={s.container}>
      <Text style={s.h1}>Objects</Text>
      <TouchableOpacity
        style={s.row}
        onPress={() => navigation.navigate("ObjectDetail", demo)}
      >
        <Text style={s.rowText}>
          {demo.type} — {demo.id}
        </Text>
      </TouchableOpacity>
      <Text style={{ marginTop: 12 }}>
        (Replace with real query + list later.)
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#eee",
  },
  rowText: { fontSize: 16, fontWeight: "600" },
});
