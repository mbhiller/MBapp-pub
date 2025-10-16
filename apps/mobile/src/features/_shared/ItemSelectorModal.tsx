import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Keyboard } from "react-native";
import { useColors } from "./useColors";
import { searchObjects } from "../../api/client";

type Obj = Record<string, any>;

type ResultItem = {
  id: string;
  label: string;
  type?: string;
  raw?: Obj;
};

function mapToResultItems(type: string, rows: Obj[]): ResultItem[] {
  return rows
    .map((r) => {
      const id = String(r?.id ?? r?.itemId ?? r?.productId ?? r?.sku ?? r?.code ?? "");
      const label = String(r?.name ?? r?.label ?? r?.sku ?? r?.code ?? r?.id ?? "");
      return id ? { id, label, type, raw: r } : null;
    })
    .filter(Boolean) as ResultItem[];
}

type Props = {
  /** "product" to search products, "item" to search inventory items */
  mode?: "product" | "item";
  /** Optional extra filters passed to the search endpoint */
  filters?: Obj;
  /** Called when user selects one; modal should be closed by parent */
  onSelect: (sel: ResultItem) => void;
  /** Called when user closes without selection */
  onClose: () => void;
  /** Autostart search text */
  initialQuery?: string;
  /** Placeholder to show in the search input */
  placeholder?: string;
  /** Optional: render right-side info per row (e.g., stock/counters) */
  renderRight?: (raw: Obj) => React.ReactNode;
};

export default function ItemSelectorModal({
  mode = "product",
  filters = {},
  onSelect,
  onClose,
  initialQuery = "",
  placeholder,
  renderRight,
}: Props) {
  const t = useColors();
  const [q, setQ] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ResultItem[]>([]);
  const [open, setOpen] = useState(true);
  const mounted = useRef(true);

  const typeKey = mode === "item" ? "inventoryItems" : "products";
  const hint = placeholder ?? (mode === "item" ? "Search items (sku, code, name)..." : "Search products...");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function runSearch(query: string) {
    setBusy(true);
    try {
      const body: Obj = { q: query, ...filters };
      const page = await searchObjects<Obj>(typeKey, body, { limit: 25 });
      const list = mapToResultItems(typeKey, page.items as any);
      if (mounted.current) setRows(list);
    } catch (e) {
      if (mounted.current) setRows([]);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => { runSearch(q); }, [q, typeKey]);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
        {mode === "item" ? "Select Item" : "Select Product"}
      </Text>
      <TextInput
        autoFocus
        value={q}
        onChangeText={(v) => { setQ(v); setOpen(true); }}
        placeholder={hint}
        placeholderTextColor={t.colors.textMuted}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text, marginBottom: 6 }}
      />

      {busy && <ActivityIndicator style={{ padding: 8 }} />}

      {open && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 420, borderTopWidth: 1, borderColor: t.colors.border }}
        >
          {rows.map((ri) => (
            <Pressable
              key={`${ri.type}:${ri.id}`}
              onPress={() => {
                onSelect(ri);
                // Immediately close & freeze; parent will close modal
                setOpen(false);
                Keyboard.dismiss();
                onClose();
              }}
              style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
            >
              <View>
                <Text style={{ color: t.colors.text, fontWeight: "600" }}>{ri.label}</Text>
                <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>{ri.id}</Text>
              </View>
              <View>
                {renderRight ? renderRight(ri.raw || {}) : null}
              </View>
            </Pressable>
          ))}

          {!busy && rows.length === 0 && (
            <View style={{ padding: 16 }}>
              <Text style={{ color: t.colors.textMuted }}>No results.</Text>
            </View>
          )}
        </ScrollView>
      )}

      <Pressable
        onPress={onClose}
        style={{ marginTop: 12, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}
      >
        <Text style={{ color: t.colors.text }}>Close</Text>
      </Pressable>
    </View>
  );
}
