import React, { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackScreenProps } from "../navigation/types";
import { Fab } from "../ui/Fab";
import { listInventory } from "../features/inventory/api";
import type { InventoryItem, ListPage } from "../features/inventory/types";

type Props = RootStackScreenProps<"InventoryList">;
type Page = ListPage<InventoryItem>;

export default function InventoryListScreen({ navigation }: Props) {
  const t = useTheme();

  const q = useInfiniteQuery<
    Page, Error, InfiniteData<Page>, ["inventory","list"], string | undefined
  >({
    queryKey: ["inventory", "list"],
    queryFn: ({ pageParam }) => listInventory({ next: pageParam }),
    getNextPageParam: (last) => last?.next ?? undefined,
    initialPageParam: undefined,
  });

  // refetch when screen regains focus (no dependency loop)
  useFocusEffect(useCallback(() => { q.refetch(); }, []));

  const items = q.data?.pages.flatMap(p => p?.items ?? []) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg, padding: 10 }}>
      {q.isLoading && items.length === 0 ? <ActivityIndicator /> : null}
      {q.isError ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{q.error.message}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        refreshing={q.isRefetching || q.isFetching}
        onRefresh={() => q.refetch()}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("InventoryDetail", { id: item.id })}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
            }}
          >
            <Text style={{ fontWeight: "700" as const, color: t.colors.text }}>
              {item.name ?? item.sku ?? "(no name)"}
            </Text>
            <Text style={{ color: t.colors.text }}>
              Qty: {item.qtyOnHand} {item.uom ?? ""}
            </Text>
            {item.location ? (
              <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>Loc: {item.location}</Text>
            ) : null}
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />

      <Fab label="New" onPress={() => navigation.navigate("InventoryDetail", { mode: "new" })} />
    </View>
  );
}