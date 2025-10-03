import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { PurchaseOrders } from "../features/purchaseOrders/hooks";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function PurchaseOrdersListScreen({ navigation }: any) {
  const t = useColors();
  const ql = PurchaseOrders.useList({ limit: 20 });
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
        keyExtractor={(i, idx) => String((i as any).id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={({ item }) => {
          const po: any = item;
          const title =
            po.orderNumber ||
            po.vendorName ||
            (po.id ? `PO ${String(po.id).slice(0, 8)}` : "(new purchase order)");

          const parts: string[] = [];
          if (po.vendorName) parts.push(`Vendor: ${po.vendorName}`);
          else if (po.vendorId) parts.push(`VendorId: ${po.vendorId}`);
          if (po.status) parts.push(`Status: ${String(po.status)}`);
          if (po.totals?.total != null && !isNaN(Number(po.totals.total))) {
            parts.push(`Total: $${Number(po.totals.total).toFixed(2)}`);
          }
          const subtitle = parts.join(" • ");

          return (
            <Pressable
              onPress={() => navigation.navigate("PurchaseOrderDetail", { id: String(po.id), mode: "edit" })}
              style={{
                backgroundColor: t.colors.card,
                borderColor: t.colors.border,
                borderWidth: 1,
                borderRadius: 12,
                marginBottom: 10,
                padding: 12,
              }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
              {!!subtitle && <Text style={{ color: t.colors.muted, marginTop: 2 }}>{subtitle}</Text>}
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>No purchase orders yet.</Text>}
        contentContainerStyle={{ paddingBottom: 72 }}
      />

      <Pressable
        onPress={() => navigation.navigate("PurchaseOrderDetail", { mode: "new" })}
        style={{
          position: "absolute", right: 16, bottom: 16,
          backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999,
          shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
