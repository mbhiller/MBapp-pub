import React, { useCallback, useMemo, useState, useEffect } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useInfiniteQuery, type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { TextInput, Button } from "react-native-paper";

import { useTheme } from "../providers/ThemeProvider";
import type { RootStackScreenProps } from "../navigation/types";
import { Fab } from "../ui/Fab";
import { listInventory } from "../features/inventory/api";
import type { InventoryItem, ListPage } from "../features/inventory/types";

type Props = RootStackScreenProps<"InventoryList">;
type Page = ListPage<InventoryItem>;

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function InventoryListScreen({ navigation }: Props) {
  const t = useTheme();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const qDeb = useDebouncedValue(search);
  const kindDeb = useDebouncedValue(kind);

  // Stable key with filter params so cache behaves & invalidation hits all variants
  const queryKey = useMemo(
    () => ["inventory", "list", { q: qDeb || "", kind: kindDeb || "" }] as const,
    [qDeb, kindDeb]
  );

  const q = useInfiniteQuery<
    Page,
    Error,
    InfiniteData<Page>,
    typeof queryKey,
    string | undefined
  >({
    queryKey,
    queryFn: ({ pageParam }) =>
      listInventory({
        next: pageParam,
        q: qDeb || undefined,
        kind: kindDeb || undefined,
      }),
    getNextPageParam: (last) => last?.next ?? undefined,
    initialPageParam: undefined,
  });

  // Refetch on focus (keeps data fresh after edits)
  useFocusEffect(useCallback(() => { q.refetch(); }, []));

  const items = q.data?.pages.flatMap((p) => p?.items ?? []) ?? [];

  // Simple clear helpers
  const clearFilters = () => {
    setSearch("");
    setKind("");
    // Clear all inventory list caches to avoid stale filtered pages hanging around
    qc.invalidateQueries({ queryKey: ["inventory", "list"] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {/* Filters */}
      <View style={{ padding: 12, gap: 8 }}>
        <TextInput
          mode="outlined"
          label="Search (name or sku)"
          value={search}
          onChangeText={setSearch}
          right={
            search
              ? <TextInput.Icon icon="close" onPress={() => setSearch("")} />
              : undefined
          }
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <TextInput
              mode="outlined"
              label="Kind (optional)"
              value={kind}
              onChangeText={setKind}
              right={
                kind
                  ? <TextInput.Icon icon="close" onPress={() => setKind("")} />
                  : undefined
              }
            />
          </View>
          <Button mode="text" onPress={clearFilters} style={{ alignSelf: "center" }}>
            Clear
          </Button>
        </View>
      </View>

      {/* List */}
      <View style={{ flex: 1, padding: 10 }}>
        {q.isLoading && items.length === 0 ? <ActivityIndicator /> : null}
        {q.isError ? (
          <Text style={{ color: t.colors.danger, marginBottom: 8 }}>
            {q.error.message}
          </Text>
        ) : null}

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
                <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>
                  Loc: {item.location}
                </Text>
              ) : null}
              <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>
                {item.id}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !q.isLoading ? (
              <View style={{ padding: 24 }}>
                <Text style={{ color: t.colors.textMuted }}>
                  No inventory found{qDeb || kindDeb ? " (filters applied)" : ""}.
                </Text>
              </View>
            ) : null
          }
        />

        <Fab
          label="New"
          onPress={() => navigation.navigate("InventoryDetail", { mode: "new" })}
        />
      </View>
    </View>
  );
}
