import * as React from "react";
import { View, Text } from "react-native";
import { useColors } from "./useColors";

export function BackorderBanner({ shortages }: { shortages?: Array<{ lineId?: string; itemId?: string; backordered?: number }> }) {
  const t = useColors();
  if (!Array.isArray(shortages) || shortages.length === 0) return null;
  const total = shortages.reduce((s, x) => s + Math.max(0, Number(x?.backordered ?? 0)), 0);

  return (
    <View style={{
      borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card,
      padding: 12, borderRadius: 10, marginBottom: 8
    }}>
      <Text style={{ color: t.colors.text, fontWeight: "700" }}>Backorder</Text>
      <Text style={{ color: t.colors.muted, marginTop: 4 }}>
        {total} unit{total === 1 ? "" : "s"} backordered across {shortages.length} line{shortages.length === 1 ? "" : "s"}.
      </Text>
      {shortages.map((s, i) => (
        <Text key={i} style={{ color: t.colors.muted }}>
          • Line {s.lineId ?? "?"} ({s.itemId ?? "item"}): {s.backordered ?? 0}
        </Text>
      ))}
    </View>
  );
}
