import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Events } from "../features/events/hooks";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useRegistrationsCount } from "../features/registrations/useRegistrationsCount";

function RegBadge({ eventId }: { eventId: string }) {
  const t = useColors();
  const { data } = useRegistrationsCount(eventId);
  return (
    <View
      style={{
        backgroundColor: t.colors.primary,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        minWidth: 24,
        alignItems: "center",
        marginLeft: 8,
      }}
    >
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
        {typeof data === "number" ? data : "—"}
      </Text>
    </View>
  );
}

export default function EventsListScreen({ navigation }: any) {
  const t = useColors();
  const q = Events.useList({ limit: 20 });
  const { data, isLoading, isRefetching, refetch } = q;

  // Silent background refresh on focus (no spinner)
  const refetchStable = React.useCallback(() => {
    if (!q.isRefetching && !q.isLoading) refetch();
  }, [refetch, q.isRefetching, q.isLoading]);
  useRefetchOnFocus(refetchStable);

  const items = data?.items ?? [];
  const refreshing = isLoading; // <-- only spinner on manual pull

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchStable} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("EventDetail", { id: item.id })}
            style={{
              backgroundColor: t.colors.card,
              borderColor: t.colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>
                {item.name || "(no title)"}
              </Text>
              {/* registrations badge on list row */}
              <RegBadge eventId={item.id} />
            </View>
            <Text style={{ color: t.colors.muted, marginTop: 2 }}>
              {item.startDate ? new Date(item.startDate).toLocaleString() : item.id}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
              No events yet.
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 72 }}
      />

      <Pressable
        onPress={() => navigation.navigate("EventDetail", { id: undefined })}
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
