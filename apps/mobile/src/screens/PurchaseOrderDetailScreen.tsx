import * as React from "react";
import { View, Text, ActivityIndicator, FlatList } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useObject } from "../features/_shared/useObject";

export default function PurchaseOrderDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading } = useObject<any>("purchaseOrder", id);
  const po = data;
  const lines = (po?.lines ?? []) as any[];

  if (isLoading) return <ActivityIndicator />;

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Purchase Order {po?.id}</Text>
      <Text>Status: {po?.status}</Text>
      <FlatList
        style={{ marginTop: 12 }}
        data={lines}
        keyExtractor={(l: any) => String(l.id ?? l.itemId)}
        renderItem={({ item: line }: any) => (
          <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
            <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
            <Text>Qty: {line.qty} {line.uom || "ea"}</Text>
          </View>
        )}
      />
    </View>
  );
}
