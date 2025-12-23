import * as React from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useRoute, useFocusEffect } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import StockCard from "../features/inventory/StockCard";
import { useStock } from "../features/inventory/useStock";
import { useToast } from "../features/_shared/Toast";
import { copyText } from "../features/_shared/copy";

export default function InventoryDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading, error } = useObjects<any>({ type: "inventory", id });
  const { onhand, movements, refetch } = useStock(id);
  const toast = useToast();

  useFocusEffect(
    React.useCallback(() => {
      refetch?.();
    }, [refetch])
  );

  if (isLoading) return <ActivityIndicator />;
  if (error) return <Text>{(error as any)?.message || "Failed to load"}</Text>;
  return (
    <View style={{ flex: 1, padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Inventory </Text>
        <Pressable
          onLongPress={async () => {
            if (data?.id) {
              await copyText(String(data.id));
              toast("Copied", "success");
            }
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700" }}>{data?.id}</Text>
        </Pressable>
      </View>
      <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>
        ID: {data?.id}
      </Text>
      <Text>Name: {data?.name || "—"}</Text>
      <Text>Product: {data?.productId || "—"}</Text>
      <Text>UOM: {data?.uom || "—"}</Text>

      <StockCard itemId={id} />
    </View>
  );
}
