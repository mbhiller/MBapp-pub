import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { SalesOrders } from "../features/salesOrders/hooks";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function SalesOrdersListScreen({ navigation }: any) {
  const t = useColors();
  const ql = SalesOrders.useList({ limit: 20 });
  const { data, refetch } = ql;

  const [pulling, setPulling] = React.useState(false);
  const refetchStable = React.useCallback(() => {
    if (!ql.isRefetching && !ql.isLoading) refetch();
  }, [refetch, ql.isRefetching, ql.isLoading]);

  // Align with PurchaseOrders: debounce refetch on screen focus
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
          const so: any = item;
          const title =
            so.orderNumber ||
            so.customerName ||
            (so.id ? `SO ${String(so.id).slice(0, 8)}` : "(new sales order)");

          const parts: string[] = [];
          if (so.customerName) parts.push(`Customer: ${so.customerName}`);
          else if (so.customerId) parts.push(`CustomerId: ${so.customerId}`);
          if (so.status) parts.push(`Status: ${String(so.status)}`);
          if (so.totals?.total != null && !isNaN(Number(so.totals.total))) {
            parts.push(`Total: $${Number(so.totals.total).toFixed(2)}`);
          }
          const subtitle = parts.join(" • ");

          return (
            <Pressable
              onPress={() => navigation.navigate("SalesOrderDetail", { id: String(so.id), mode: "edit" })}
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
        ListEmptyComponent={
          <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
            No sales orders yet.
          </Text>
        }
        contentContainerStyle={{ paddingBottom: 72 }}
      />

      <Pressable
        onPress={() => navigation.navigate("SalesOrderDetail", { mode: "new" })}
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
