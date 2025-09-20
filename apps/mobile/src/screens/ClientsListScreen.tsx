import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Clients } from "../features/clients/hooks";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function ClientsListScreen({ navigation }: any) {
  const t = useColors();
  const q = Clients.useList({ limit: 20 });
  const { data, isLoading, isRefetching, refetch, error } = q;

  // Silent background refresh on focus (no spinner)
  const refetchStable = React.useCallback(() => {
    if (!q.isRefetching && !q.isLoading) refetch();
  }, [refetch, q.isRefetching, q.isLoading]);
  useRefetchOnFocus(refetchStable);

  const items = data?.items ?? [];
  const refreshing = isLoading; // <-- only show spinner on user pull, not isRefetching

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      {!!error && (
        <View style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, padding: 8, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: t.colors.muted }}>Failed to load clients.</Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchStable} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("ClientDetail", { id: item.id })}
            style={{
              backgroundColor: t.colors.card,
              borderColor: t.colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>
              {item.name || "(no name)"}
            </Text>
            {!!item.email && (
              <Text style={{ color: t.colors.muted, marginTop: 2 }}>{item.email}</Text>
            )}
            {!!item.phone && (
              <Text style={{ color: t.colors.muted, marginTop: 2 }}>{item.phone}</Text>
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
              No clients yet.
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 72 }}
      />

      <Pressable
        onPress={() => navigation.navigate("ClientDetail", { id: undefined })}
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
