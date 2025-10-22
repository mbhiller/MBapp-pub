import React from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { useColors } from "./useColors";

export type LineId = string;
export type Line = {
  id: LineId;
  itemId?: string;
  label?: string;
  qty?: number;
  price?: number;
  notes?: string;
  meta?: any;
};

export type LineEditorProps = {
  /** Controlled list of lines */
  lines: Line[];
  /** Replace entire lines array */
  onChange: (lines: Line[]) => void;
  /** Open your Item selector (parent controls add flow) */
  onAdd: () => void;
  /** Open your Item change flow for a given line */
  onEdit: (lineId: LineId) => void;
  /** Remove a line entirely */
  onRemove: (lineId: LineId) => void;

  /** Allow inline quantity editing */
  editableQty?: boolean;
  /** Allow inline price editing */
  editablePrice?: boolean;
  /** Format price display (fallback simple) */
  currencyFormatter?: (n?: number) => string;
};

function defaultCurrency(n?: number) {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  return `$${Number(n).toFixed(2)}`;
}

export default function LineEditor(props: LineEditorProps) {
  const {
    lines,
    onChange,
    onAdd,
    onEdit,
    onRemove,
    editableQty = true,
    editablePrice = false,
    currencyFormatter = defaultCurrency,
  } = props;
  const t = useColors();

  function patch(lineId: LineId, changes: Partial<Line>) {
    const next = lines.map((ln) => (ln.id === lineId ? { ...ln, ...changes } : ln));
    onChange(next);
  }

  function changeNumber(lineId: LineId, key: "qty" | "price", text: string) {
    const num = text.trim() === "" ? undefined : Number(text);
    patch(lineId, { [key]: Number.isNaN(num as any) ? undefined : (num as number) } as any);
  }

  return (
    <View style={{ gap: 10 }}>
      {lines.map((ln) => (
        <View key={ln.id} style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 12, backgroundColor: t.colors.card }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: t.colors.text, fontWeight: "600", fontSize: 16 }}>
              {ln.label ?? ln.itemId ?? ln.id}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => onEdit(ln.id)}
                style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8 }}
              >
                <Text style={{ color: t.colors.text }}>Change</Text>
              </Pressable>
              <Pressable
                onPress={() => onRemove(ln.id)}
                style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8 }}
              >
                <Text style={{ color: t.colors.text }}>Remove</Text>
              </Pressable>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 12, marginTop: 10, alignItems: "center" }}>
            {/* Qty */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Qty</Text>
              {editableQty ? (
                <TextInput
                  keyboardType="numeric"
                  value={ln.qty === undefined ? "" : String(ln.qty)}
                  onChangeText={(txt) => changeNumber(ln.id, "qty", txt)}
                  style={{ minWidth: 60, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 6, color: t.colors.text }}
                  placeholder="0"
                  placeholderTextColor={t.colors.textMuted}
                />
              ) : (
                <Text style={{ color: t.colors.text }}>{ln.qty ?? ""}</Text>
              )}
            </View>

            {/* Price */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Price</Text>
              {editablePrice ? (
                <TextInput
                  keyboardType="numeric"
                  value={ln.price === undefined ? "" : String(ln.price)}
                  onChangeText={(txt) => changeNumber(ln.id, "price", txt)}
                  style={{ minWidth: 80, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 6, color: t.colors.text }}
                  placeholder="$0.00"
                  placeholderTextColor={t.colors.textMuted}
                />
              ) : (
                <Text style={{ color: t.colors.text }}>{currencyFormatter(ln.price)}</Text>
              )}
            </View>

            {/* Total */}
            <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Total</Text>
              <Text style={{ color: t.colors.text, fontWeight: "600" }}>
                {currencyFormatter((ln.qty ?? 0) * (ln.price ?? 0))}
              </Text>
            </View>
          </View>

          {!!ln.notes && (
            <Text style={{ color: t.colors.textMuted, marginTop: 6 }}>{ln.notes}</Text>
          )}
        </View>
      ))}

      <Pressable
        onPress={onAdd}
        style={{ alignSelf: "flex-start", backgroundColor: t.colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ Add Line</Text>
      </Pressable>
    </View>
  );
}
