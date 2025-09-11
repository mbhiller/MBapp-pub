import React, { useMemo } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { useProducts } from "../features/catalog/useProducts";

export default function ProductsListScreen({ navigation }: RootStackScreenProps<"Products">) {
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, error } = useProducts(undefined);

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading products…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: "crimson" }}>Error: {(error as Error).message}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 8 }}>
        <TouchableOpacity style={{ paddingHorizontal: 8 }} onPress={() => navigation.navigate("ProductDetail", { mode: "new" })}>
          <Text style={{ color: "#3478f6", fontWeight: "700" }}>New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("ProductDetail", { id: item.id, mode: "edit" })}
            style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#eee", backgroundColor: "#fff" }}
          >
            <Text style={{ fontWeight: "600" }}>{item.name}</Text>
            <Text style={{ opacity: 0.7, marginTop: 2 }}>{item.sku ?? "—"}</Text>
          </TouchableOpacity>
        )}
        onEndReached={() => hasNextPage && fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={{ margin: 12 }} /> : null}
      />
    </View>
  );
}
