import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import type { Registration } from "../features/registrations/types";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useColors } from "../providers/useColors";

export default function RegistrationsListScreen({ route, navigation }: any) {
  const t = useColors();
  const eventId: string | undefined = route?.params?.eventId;

  // Match Events list: use isLoading for the refresh control
  const { data, isLoading, refetch } = Registrations.useList({ limit: 20, eventId });

  // Same focus refetch behavior
  useRefetchOnFocus(() => refetch());

  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 8 }}>
      <FlatList
        data={items}
        keyExtractor={(item: Registration) => item.id}
        // Use RefreshControl (prevents "always refreshing" look)
        refreshControl={<RefreshControl refreshing={!!isLoading} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("RegistrationDetail", { id: item.id })}
            style={{ padding: 12 }}
          >
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>
              {item.name || "(Unnamed Registration)"}
            </Text>
            {!!item.eventId && (
              <Text style={{ color: t.colors.muted, marginTop: 2 }}>
                Event: {item.eventId}
              </Text>
            )}
            {!!item.status && (
              <Text style={{ color: t.colors.muted, marginTop: 2 }}>
                Status: {item.status}
              </Text>
            )}
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.colors.border }} />}
      />

      <Pressable
        onPress={() => navigation.navigate("RegistrationDetail", { mode: "new", eventId })}
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
