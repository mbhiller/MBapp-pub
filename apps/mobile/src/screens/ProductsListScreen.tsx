import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackScreenProps } from "../navigation/types";
import { listProducts, type Product } from "../features/products/api";
import { useTheme } from "../providers/ThemeProvider";
import { Fab } from "../ui/Fab";

type Props = RootStackScreenProps<"ProductsList">;

export default function ProductsListScreen({ navigation }: Props) {
  const t = useTheme();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err,   setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await listProducts({ limit: 50, order: "desc" });
      setItems(data.items ?? []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator />
        {err ? <Text style={{ marginTop: 8, color: t.colors.danger }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 10, backgroundColor: t.colors.bg }}>
      {err ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{err}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("ProductDetail", { id: item.id })}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
            }}
          >
            <Text style={{ fontWeight: "700" as const, color: t.colors.text }}>{item.name || "(no name)"}</Text>
            <Text style={{ color: t.colors.text }}>
              {item.sku ?? "—"}  •  {item.price != null ? `$${item.price}` : "no price"}
            </Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.kind ?? "—"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />
      <Fab label="New" onPress={() => navigation.navigate("ProductDetail", { mode: "new" })} />
    </View>
  );
}
