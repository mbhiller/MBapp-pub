import React from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import MODULES from "../features/_shared/modules";
import { useColors } from "../features/_shared/useColors";

export default function ModuleHubScreen({ navigation }: any) {
  const t = useColors();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {MODULES.map((m) => (
          <Pressable
            key={m.key}
            onPress={() => navigation.navigate(m.screen as any)}
            style={{
              width: "48%",
              minHeight: 90,
              backgroundColor: t.colors.card,
              borderColor: t.colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 4 }}>{m.title}</Text>
            <Text style={{ color: t.colors.muted, fontSize: 12 }}>{m.key}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
