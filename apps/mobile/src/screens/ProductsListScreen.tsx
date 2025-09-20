// apps/mobile/src/screens/ProductsListScreen.tsx
import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Products } from "../features/products/hooks";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function ProductsListScreen({ navigation }: any) {
  const t = useColors();
  const q = Products.useList({ limit: 20 });
  const { data, isLoading, isRefetching, refetch, error } = q;

  const refetchStable = React.useCallback(() => {
    if (!q.isRefetching && !q.isLoading) refetch();
  }, [refetch, q.isRefetching, q.isLoading]);

  useRefetchOnFocus(refetchStable);

  const items = Array.isArray(data?.items) ? data!.items : [];
  const refreshing = isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      {!!error && (
        <View style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, padding: 8, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: t.colors.muted }}>Failed to load products.</Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchStable} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("ProductDetail", { id: item.id })}
            style={{
              backgroundColor: t.colors.card,
              borderColor: t.colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>
                {item.name || item.sku || "(unnamed)"}
              </Text>
              {!!item.kind && (
                <View
                  style={{
                    backgroundColor: t.colors.primary,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 999,
                    marginLeft: 8,
                  }}
                >
                  <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{item.kind}</Text>
                </View>
              )}
            </View>
            <Text style={{ color: t.colors.muted, marginTop: 2 }}>
              {item.sku ? `SKU: ${item.sku}` : "—"}{typeof item.price === "number" ? ` • $${item.price.toFixed(2)}` : ""}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
              No products yet.
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 72 }}
      />

      <Pressable
        onPress={() => navigation.navigate("ProductDetail", { id: undefined })}
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          backgroundColor: t.colors.primary,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
