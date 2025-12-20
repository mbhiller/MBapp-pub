// apps/mobile/src/screens/SalesOrderDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, FlatList } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { BackorderHeaderBadge, BackorderLineBadge } from "../features/backorders/BackorderBadges";

export default function SalesOrderDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading } = useObjects<any>({ type: "salesOrder", id });

  const so = data;
  const lines = (so?.lines ?? []) as any[];
  const backorders = (so?.backorders ?? []) as any[];

  // Build line -> backordered map if needed
  const boMap: Record<string, number> = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const bo of backorders) {
      const lid = String(bo?.soLineId ?? "");
      const qty = Number(bo?.qty ?? 0);
      if (!lid || qty <= 0) continue;
      m[lid] = (m[lid] ?? 0) + qty;
    }
    return m;
  }, [JSON.stringify(backorders)]);

  if (isLoading) return <ActivityIndicator />;

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Sales Order {so?.id}</Text>
      <Text>Status: {so?.status}</Text>
      <BackorderHeaderBadge count={backorders.length} />

      <FlatList
        style={{ marginTop: 12 }}
        data={lines}
        keyExtractor={(l: any) => String(l.id ?? l.itemId)}
        renderItem={({ item: line }: any) => (
          <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
            <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
            <Text>Qty: {line.qty} {line.uom || "ea"}</Text>
            <BackorderLineBadge qty={(line as any)?.backordered ?? boMap[String(line.id ?? "")]} />
          </View>
        )}
      />
    </View>
  );
}
