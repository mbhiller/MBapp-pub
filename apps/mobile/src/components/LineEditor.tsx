// apps/mobile/src/components/LineEditor.tsx
import * as React from "react";
import { View, Text, TextInput, Pressable, ScrollView } from "react-native";
import { generateCid, getOrGenerateLineKey, ensureLineCid } from "../lib/cidGeneration";

export type EditableLine = {
  id?: string;
  cid?: string;
  itemId?: string;
  qty?: number;
  uom?: string;
};

type Props = {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  canEdit: boolean;
  addLabel?: string;
};

/**
 * Get stable React key: prefer server id, else cid.
 * Never uses index-based keys (unstable on reorder/delete).
 */
function getLineKey(line: EditableLine): string {
  return getOrGenerateLineKey(line);
}

export function LineEditor({ lines, onChange, canEdit, addLabel = "+ Add Line" }: Props) {
  // Ensure all lines have cid when missing (for new unsaved rows)
  const ensuredLines = React.useMemo(() => lines.map(ln => ensureLineCid(ln)), [lines]);

  const handleChange = (idx: number, key: keyof EditableLine, value: string | number) => {
    const next = [...lines];
    const line = { ...next[idx] };
    if (key === "qty") {
      const n = Number(value);
      line.qty = Number.isFinite(n) ? n : 0;
    } else if (key === "itemId" || key === "uom") {
      line[key] = typeof value === "string" ? value : String(value ?? "");
    }
    next[idx] = ensureLineCid(line); // Ensure cid after update
    onChange(next);
  };

  const handleRemove = (idx: number) => {
    // Remove line at index; truly delete from array
    onChange(lines.filter((_, i) => i !== idx));
  };

  const addLine = () => {
    onChange([
      ...lines,
      { cid: generateCid(), itemId: "", qty: 1, uom: "ea" },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>
      {ensuredLines.map((line, idx) => {
        const key = getLineKey(line);
        return (
          <View key={key} style={{ padding: 10, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, gap: 8 }}>
            <Text style={{ fontWeight: "600" }}>Line {line.id || line.cid || idx + 1}</Text>
            <View style={{ gap: 6 }}>
              <Text>Item</Text>
              <TextInput
                editable={canEdit}
                value={line.itemId ?? ""}
                onChangeText={(v) => handleChange(idx, "itemId", v)}
                placeholder="Item ID"
                style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 }}
              />
            </View>
            <View style={{ gap: 6 }}>
              <Text>Qty</Text>
              <TextInput
                editable={canEdit}
                keyboardType="numeric"
                value={String(line.qty ?? 0)}
                onChangeText={(v) => handleChange(idx, "qty", v)}
                style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 }}
              />
            </View>
            <View style={{ gap: 6 }}>
              <Text>UOM</Text>
              <TextInput
                editable={canEdit}
                value={line.uom ?? "ea"}
                onChangeText={(v) => handleChange(idx, "uom", v || "ea")}
                style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 }}
              />
            </View>
            <Pressable
              disabled={!canEdit}
              onPress={() => handleRemove(idx)}
              style={{
                padding: 10,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: "#d32f2f",
                backgroundColor: canEdit ? "#ffebee" : "#f5f5f5",
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#d32f2f", fontWeight: "700" }}>Remove</Text>
            </Pressable>
          </View>
        );
      })}

      <Pressable
        disabled={!canEdit}
        onPress={addLine}
        style={{
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: "#1976d2",
          backgroundColor: canEdit ? "#e3f2fd" : "#f5f5f5",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#1976d2", fontWeight: "700" }}>{addLabel}</Text>
      </Pressable>
    </ScrollView>
  );
}
