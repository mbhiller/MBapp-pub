// List "open" BackorderRequest rows with Ignore/Convert actions.
import * as React from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useObjectsList } from "../features/_shared/useObjectsList";
import { apiClient } from "../api/client";

export default function BackordersListScreen() {
  const { data, isLoading, refetch } = useObjectsList<any>({ type: "backorderRequest", q: "open" });
  const items = data?.pages?.flatMap((p: any) => p.items) ?? [];

  async function act(id: string, action: "ignore" | "convert") {
    await apiClient.post(`/objects/backorderRequest/${encodeURIComponent(id)}:${action}`, {});
    await refetch();
  }

  if (isLoading) return <ActivityIndicator />;

  return (
    <FlatList
      data={items}
      keyExtractor={(it) => it.id}
      contentContainerStyle={{ padding: 12 }}
      renderItem={({ item }) => (
        <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 10 }}>
          <Text style={{ fontWeight: "600" }}>{item.itemId}</Text>
          <Text>SO: {item.soId} • Line: {item.soLineId}</Text>
          <Text>Qty: {item.qty} • Status: {item.status}</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <Pressable onPress={() => act(item.id, "ignore")} style={{ padding: 6 }}>
              <Text>Ignore</Text>
            </Pressable>
            <Pressable onPress={() => act(item.id, "convert")} style={{ padding: 6 }}>
              <Text>Convert</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}
