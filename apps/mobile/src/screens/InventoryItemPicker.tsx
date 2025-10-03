import React from "react";
import { View, Text, TextInput, Pressable, FlatList } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { apiClient } from "../api/client";

type Item = { id: string; label: string; uom?: string; onHand?: number; reserved?: number; available?: number };

export default function InventoryItemPicker({
  onSelect,
  placeholder = "Search inventory…",
}: {
  onSelect: (item: Item) => void;
  placeholder?: string;
}) {
  const t = useColors();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Item[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const run = React.useCallback(async (term: string) => {
    setLoading(true);
    try {
      const res = await apiClient.post<{ items: Item[] }>(`/inventory/search`, { query: term, limit: 20 });
      setResults(res.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const h = setTimeout(() => {
      if (q.trim().length >= 1) run(q.trim());
      else setResults([]);
    }, 200);
    return () => clearTimeout(h);
  }, [q, run]);

  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ marginBottom: 6, color: t.colors.muted }}>Inventory Item</Text>
      <TextInput
        value={q}
        onChangeText={(v) => { setQ(v); setOpen(true); }}
        placeholder={placeholder}
        placeholderTextColor={t.colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12 }}
      />
      {open && (loading || results.length > 0) && (
        <View style={{ marginTop: 6, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card, borderRadius: 8, maxHeight: 240, overflow: "hidden" }}>
          {loading ? (
            <Text style={{ color: t.colors.muted, padding: 10 }}>Searching…</Text>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { onSelect(item); setQ(item.label); setOpen(false); }}
                  style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border }}
                >
                  <Text style={{ color: t.colors.text, fontWeight: "600" }}>{item.label}</Text>
                  <Text style={{ color: t.colors.muted, marginTop: 2 }}>
                    #{item.id} • {item.uom || "each"} • On-hand: {item.onHand ?? "—"} • Reserved: {item.reserved ?? "—"} • Available: {item.available ?? "—"}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </View>
      )}
    </View>
  );
}
