import React, { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackScreenProps } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";
import { Fab } from "../ui/Fab";
import { listProducts, type Product } from "../features/products/api";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";

type Props = RootStackScreenProps<"ProductsList">;

type Page = { items: Product[]; next?: string };

export default function ProductsListScreen({ navigation }: Props) {
  const t = useTheme();

  const q = useInfiniteQuery<
    Page, Error, InfiniteData<Page>, ["products","list"], string | undefined
  >({
    queryKey: ["products", "list"],
    queryFn: ({ pageParam }) => listProducts({ next: pageParam }),
    getNextPageParam: (last) => last?.next ?? undefined,
    initialPageParam: undefined,
    // optional: refetch when screen focused (Expo dev)
    // refetchOnWindowFocus: "always",
  });

  // only refetch when the screen gains focus (not on every render)
  useFocusEffect(useCallback(() => { q.refetch(); }, []));
  const items = q.data?.pages.flatMap(p => p?.items ?? []) ?? [];

  return (
    <View style={{ flex: 1, padding: 10, backgroundColor: t.colors.bg }}>
      {q.isLoading && items.length === 0 ? <ActivityIndicator /> : null}
      {q.isError ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{q.error.message}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        refreshing={q.isRefetching || q.isFetching}
        onRefresh={() => q.refetch()}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("ProductDetail", { id: item.id })}
            style={{
              padding: 14, borderRadius: 12, backgroundColor: t.colors.card,
              borderWidth: 1, borderColor: t.colors.border,
            }}
          >
            <Text style={{ fontWeight: "700" as const, color: t.colors.text }}>{item.name || "(no name)"}</Text>
            <Text style={{ color: t.colors.text }}>
              {item.sku ?? "—"}  •  {item.price != null ? `$${item.price}` : "no price"}
            </Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.kind ?? "—"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />
      <Fab label="New" onPress={() => navigation.navigate("ProductDetail", { mode: "new" })} />
    </View>
  );
}
