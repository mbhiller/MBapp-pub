// apps/mobile/src/screens/ProductsListScreen.tsx
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useProducts } from "../features/catalog/useProducts";

export default function ProductsListScreen() {
  const navigation = useNavigation<any>();
  const [q, setQ] = useState("");
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useProducts({ q });

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  const onEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <View style={{ flex: 1, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          placeholder="Search products (name or sku)"
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => refetch()}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        />
        <TouchableOpacity
          style={{ paddingHorizontal: 12, justifyContent: "center" }}
          onPress={() => navigation.navigate("ProductDetail", { mode: "new" })}
        >
          <Text style={{ color: "#007aff", fontWeight: "600" }}>+ New</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          onEndReached={onEnd}
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => navigation.navigate("ProductDetail", { id: item.id })}
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: "#eee",
                borderRadius: 10,
                marginBottom: 8,
                backgroundColor: "white",
              }}
            >
              <Text style={{ fontWeight: "700" }}>{item.name}</Text>
              <Text style={{ color: "#666", marginTop: 2 }}>{item.sku}</Text>
              <Text style={{ color: "#333", marginTop: 4 }}>
                {item.type} • {item.uom} • ${item.price}
              </Text>
            </TouchableOpacity>
          )}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ padding: 12 }}>
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}
