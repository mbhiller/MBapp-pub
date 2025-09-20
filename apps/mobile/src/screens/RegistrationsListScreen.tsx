import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function RegistrationsListScreen({ route, navigation }: any) {
  const eventId: string | undefined = route?.params?.eventId; // prefilled when navigated from Event
  const t = useColors();

  const q = Registrations.useList({ eventId, limit: 20 });
  const { data, isLoading, isRefetching, refetch, error } = q;

  const refetchStable = React.useCallback(() => {
    if (!q.isRefetching && !q.isLoading) refetch();
  }, [refetch, q.isRefetching, q.isLoading]);

  useRefetchOnFocus(refetchStable);

  // v5-safe defensive access
  const items = Array.isArray(data?.items) ? data!.items : [];
  const refreshing = isLoading; // spinner only when user pulls; focus refetch is silent

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      {!!error && (
        <View
          style={{
            backgroundColor: t.colors.card,
            borderColor: t.colors.border,
            borderWidth: 1,
            padding: 8,
            borderRadius: 8,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: t.colors.muted }}>Failed to load registrations.</Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchStable} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("RegistrationDetail", { id: item.id, eventId })}
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
              {item.name || item.clientId || "(no name)"}
            </Text>
            <Text style={{ color: t.colors.muted, marginTop: 2 }}>
              {item.status ? `Status: ${item.status}` : "—"}
              {item.eventId ? ` • Event: ${item.eventId}` : ""}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          !refreshing ? (
            <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
              No registrations yet.
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 72 }}
      />

      <Pressable
        onPress={() => navigation.navigate("RegistrationDetail", { id: undefined, eventId })}
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
