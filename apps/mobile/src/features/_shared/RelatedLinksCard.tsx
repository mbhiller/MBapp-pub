import React from "react";
import { View, Text, Pressable } from "react-native";
import { useColors } from "./useColors";

export type LinkItem = { label: string; onPress: () => void };

export default function RelatedLinksCard({ title = "Related", links }: { title?: string; links: LinkItem[] }) {
  const t = useColors();
  if (!links?.length) return null;

  return (
    <View style={{
      backgroundColor: t.colors.card,
      borderColor: t.colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginTop: 12,
    }}>
      <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>{title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {links.map((l, i) => (
          <Pressable
            key={i}
            onPress={l.onPress}
            style={{ backgroundColor: t.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}
          >
            <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
