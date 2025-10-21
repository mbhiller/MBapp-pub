import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useObject } from "../features/_shared/useObject";

export default function InventoryDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading } = useObject<any>("inventory", id);

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
