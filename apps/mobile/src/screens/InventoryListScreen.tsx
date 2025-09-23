import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Inventory } from "../features/inventory/hooks";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function InventoryListScreen({ navigation }: any) {
  const t = useColors();
  const ql = Inventory.useList({ limit: 20 });
  const { data, refetch } = ql;

  const [pulling, setPulling] = React.useState(false);
  const refetchStable = React.useCallback(() => {
    if (!ql.isRefetching && !ql.isLoading) refetch();
  }, [refetch, ql.isRefetching, ql.isLoading]);
  useRefetchOnFocus(refetchStable, { debounceMs: 150 });

  const onPull = React.useCallback(async () => {
    setPulling(true);
    try { await refetch(); } finally { setPulling(false); }
  }, [refetch]);

  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <FlatList
        data={items}
        keyExtractor={(i, idx) => String((i as any)?.id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={({ item }) => {
          const id = String((item as any)?.id ?? "");
          const name = (item as any)?.name ? String((item as any).name) : undefined;
          const sku = (item as any)?.sku ? String((item as any).sku) : undefined;
          const status = (item as any)?.status ? String((item as any).status) : undefined;
          const quantity = (item as any)?.quantity != null ? Number((item as any).quantity) : undefined;
          const location = (item as any)?.location ? String((item as any).location) : undefined;

          return (
            <Pressable
              onPress={() => navigation.navigate("InventoryDetail", { id, mode: "edit" })}
              style={{
                backgroundColor: t.colors.card,
                borderColor: t.colors.border,
                borderWidth: 1, borderRadius: 12,
                marginBottom: 10, padding: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexShrink: 1, paddingRight: 12 }}>
                  <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>
                    {name ?? sku ?? "—"}
                  </Text>
                  {sku ? <Text style={{ color: t.colors.muted, marginTop: 2 }}>SKU: {sku}</Text> : null}
                  <Text style={{ color: t.colors.muted, marginTop: 2 }}>
                    {status ? `Status: ${status}` : "Status: —"}
                  </Text>
                  {quantity != null ? (
                    <Text style={{ color: t.colors.muted, marginTop: 2 }}>Qty: {quantity}</Text>
                  ) : null}
                  {location ? (
                    <Text style={{ color: t.colors.muted, marginTop: 2 }}>Location: {location}</Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>No inventory yet.</Text>}
        contentContainerStyle={{ paddingBottom: 72 }}
      />
      <Pressable
        onPress={() => navigation.navigate("InventoryDetail", { mode: "new" })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
