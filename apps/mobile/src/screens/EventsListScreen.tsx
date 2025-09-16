import React, { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackScreenProps } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";
import { Fab } from "../ui/Fab";
import { listEvents, type Event } from "../features/events/api";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";

type Props = RootStackScreenProps<"EventsList">;
type Page = { items: Event[]; next?: string };

export default function EventsListScreen({ navigation }: Props) {
  const t = useTheme();

  const q = useInfiniteQuery<
    Page, Error, InfiniteData<Page>, ["events","list"], string | undefined
  >({
    queryKey: ["events", "list"],
    queryFn: ({ pageParam }) => listEvents({ next: pageParam }),
    getNextPageParam: (last) => last?.next ?? undefined,
    initialPageParam: undefined,
  });

  useFocusEffect(useCallback(() => { q.refetch(); }, []));
  const items = q.data?.pages.flatMap(p => p?.items ?? []) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg, padding: 12 }}>
      {q.isLoading && items.length === 0 ? <ActivityIndicator /> : null}
      {q.isError ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{q.error.message}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        refreshing={q.isRefetching || q.isFetching}
        onRefresh={() => q.refetch()}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("EventDetail", { id: item.id })}
            style={{ backgroundColor: t.colors.card, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.colors.border }}
          >
            <Text style={{ fontWeight: "700", color: t.colors.text }}>{item.name || "(no name)"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>
              {item.startsAt ?? "unscheduled"} → {item.endsAt ?? "—"}
            </Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />

      <Fab label="New Event" onPress={() => navigation.navigate("EventDetail", { mode: "new" })} />
    </View>
  );
}
