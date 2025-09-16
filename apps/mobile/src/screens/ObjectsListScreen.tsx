// apps/mobile/src/screens/ObjectsListScreen.tsx
import React, { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { listObjects, type MbObject } from "../api/client";
import { useTheme } from "../providers/ThemeProvider";
import { Fab } from "../ui/Fab";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";

type Props = RootStackScreenProps<"ObjectsList">;
type Page = { items: MbObject[]; next?: string };

export default function ObjectsListScreen({ navigation, route }: Props) {
  const t = useTheme();
  const type = route.params?.type || "horse";

  const q = useInfiniteQuery<
    Page,                           // TQueryFnData
    Error,                          // TError
    InfiniteData<Page>,             // TData
    ["objects", string],            // TQueryKey
    string | undefined              // TPageParam
  >({
    queryKey: ["objects", type],
    queryFn: ({ pageParam }) => listObjects(type, { cursor: pageParam, limit: 50 }),
    getNextPageParam: (last) => last?.next ?? undefined,
    initialPageParam: undefined,
  });

  useFocusEffect(useCallback(() => { q.refetch(); }, [q]));

  // While loading first page, just show spinner (no error read here to avoid TS narrowing to never)
  if (q.isLoading && !q.data) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator />
      </View>
    );
  }

  const items = q.data?.pages.flatMap((p) => p?.items ?? []) ?? [];

  return (
    <View style={{ flex: 1, padding: 10, backgroundColor: t.colors.bg }}>
      {q.isError ? (
        <Text style={{ color: t.colors.danger, marginBottom: 8 }}>
          {q.error?.message ?? "Failed to load"}
        </Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(o) => o.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        refreshing={q.isRefetching || q.isFetching}
        onRefresh={() => q.refetch()}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("ObjectDetail", { type, id: item.id })}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
            }}
          >
            <Text style={{ fontWeight: "700" as const, color: t.colors.text }}>
              {item.name || "(no name)"}
            </Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />

      {/* For objects, FAB = Scan */}
      <Fab label="Scan" onPress={() => navigation.navigate("Scan", { intent: "navigate" })} />
    </View>
  );
}
