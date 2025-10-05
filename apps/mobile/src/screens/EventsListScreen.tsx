import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useObjectsList } from "../features/_shared/useObjectsList";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import type { components } from "../api/generated-types";
type Event = components["schemas"]["Event"];

export default function EventsListScreen({ navigation }: any) {
  const t = useColors();

  const q = useObjectsList<Event>({
    type: "event",
    limit: 20,
    by: "updatedAt",
    sort: "desc",
  });

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => {
    setPulling(true);
    try { await q.refetch(); } finally { setPulling(false); }
  }, [q]);

  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  const renderItem = ({ item }: { item: Event }) => {
    const id = String((item as any)?.id ?? "");
    const title = String((item as any)?.name ?? `Event ${id.slice(0, 8)}`);
    const subtitleParts: string[] = [];
    if ((item as any)?.location) subtitleParts.push(`Location: ${(item as any).location}`);
    if ((item as any)?.startsAt) subtitleParts.push(`Starts: ${new Date((item as any).startsAt).toLocaleString()}`);
    if ((item as any)?.status) subtitleParts.push(`Status: ${(item as any).status}`);
    const subtitle = subtitleParts.join(" • ");

    return (
      <Pressable
        onPress={() => navigation.navigate("EventDetail", { id, mode: "edit" })}
        style={{
          backgroundColor: t.colors.card,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: 12,
          marginBottom: 10,
          padding: 12,
        }}
      >
        <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
        <Text style={{ color: t.colors.muted, marginTop: 2 }}>{subtitle || "—"}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <FlatList
        data={q.items}
        keyExtractor={(i, idx) => String((i as any)?.id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            {q.isLoading ? (
              <ActivityIndicator />
            ) : q.isError ? (
              <Text style={{ color: t.colors.danger }}>
                Error: {String(q.error?.message ?? "unknown")}
              </Text>
            ) : (
              <Text style={{ color: t.colors.muted }}>No events.</Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />

      {q.hasNext ? (
        <Pressable
          onPress={() => q.loadMore()}
          style={{
            alignSelf: "center",
            backgroundColor: t.colors.primary,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 999,
            marginVertical: 12,
          }}
        >
          {q.isFetchingNextPage ? (
            <ActivityIndicator />
          ) : (
            <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>Load more</Text>
          )}
        </Pressable>
      ) : null}

      {/* Floating + New — navigates in "new" mode (NO server write yet) */}
      <Pressable
        onPress={() => navigation.navigate("EventDetail", { mode: "new" })}
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          backgroundColor: t.colors.primary,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
