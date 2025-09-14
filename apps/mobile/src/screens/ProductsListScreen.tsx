import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackScreenProps } from "../navigation/types";
import { listProducts, type Product } from "../features/products/api";

type Props = RootStackScreenProps<"ProductsList">;

export default function ProductsListScreen({ navigation }: Props) {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await listProducts({ limit: 50 }); // <- restart at page 1
      setItems(data.items ?? []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 🔁 refresh whenever this screen regains focus (e.g., after creating)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        {err ? <Text style={{ marginTop: 8, color: "crimson" }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 12 }}>
      {err ? <Text style={{ color: "crimson", marginBottom: 8 }}>{err}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("ProductDetail", { id: item.id, mode: "view" })}
            style={{ padding: 14, borderRadius: 10, backgroundColor: "#eee" }}
          >
            <Text style={{ fontWeight: "700" }}>{item.name || "(no name)"}</Text>
            <Text>{item.sku ?? "—"}  •  {item.price != null ? `$${item.price}` : "no price"}</Text>
            {/* NEW: show kind above id */}
            <Text style={{ color: "#444", marginTop: 4 }}>{item.kind ?? "—"}</Text>
            <Text style={{ color: "#666", marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<View style={{ padding: 20 }}><Text>No products yet. Tap “New”.</Text></View>}
        refreshing={loading}
        onRefresh={load}
      />
    </View>
  );
}
