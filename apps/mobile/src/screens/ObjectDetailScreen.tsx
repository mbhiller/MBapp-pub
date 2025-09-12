import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";

type Props = RootStackScreenProps<"ObjectDetail">;

export default function ObjectDetailScreen({ route }: Props) {
  const { id, type } = route.params;

  return (
    <View style={s.container}>
      <Text style={s.h1}>Object</Text>
      <Text style={s.kv}>Type: <Text style={s.mono}>{type}</Text></Text>
      <Text style={s.kv}>ID: <Text style={s.mono}>{id}</Text></Text>
      <Text style={{ marginTop: 12 }}>
        (Details coming soon – fields, tags, history.)
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  kv: { fontSize: 16, marginVertical: 2 },
  mono: { fontFamily: "monospace" },
});
