import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";

export default function InventoryDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading } = useObjects<any>({ type: "inventory", id });

  if (isLoading) return <ActivityIndicator />;
  return (
    <View style={{ flex: 1, padding: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>
        Inventory {data?.id}
      </Text>
      <Text>Name: {data?.name || "—"}</Text>
      <Text>Product: {data?.productId || "—"}</Text>
      <Text>UOM: {data?.uom || "—"}</Text>
    </View>
  );
}
