import React from "react";
import { View, FlatList, Text, Pressable } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import type { Registration } from "../features/registrations/types";
import {useRefetchOnFocus} from "../features/_shared/useRefetchOnFocus";
import { useColors } from "../providers/useColors";

export default function RegistrationsListScreen({ route, navigation }: any) {
  const t = useColors();
  const eventId: string | undefined = route?.params?.eventId;
  const { data, refetch, isFetching } = Registrations.useList({ limit: 20, eventId });

  useRefetchOnFocus(() => refetch());

  const items = data?.items ?? [];

  const onNew = () => {
    // Pass eventId forward so the detail screen can prefill & lock it
    navigation.navigate("RegistrationDetail", { mode: "new", eventId });
  };

  const onOpen = (id: string) => {
    navigation.navigate("RegistrationDetail", { id });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>
          {eventId ? "Registrations for Event" : "Registrations"}
        </Text>
        <Pressable
          onPress={onNew}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            backgroundColor: t.colors.primary,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>New</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it: Registration) => it.id}
        refreshing={isFetching}
        onRefresh={refetch}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item.id)}
            style={{
              marginHorizontal: 12,
              marginBottom: 10,
              padding: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: t.colors.card,
            }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "600" }}>
              {item.name ?? "(Unnamed Registration)"}
            </Text>
            {item.eventId ? (
              <Text style={{ color: t.colors.muted, marginTop: 2 }}>Event: {item.eventId}</Text>
            ) : null}
            {item.status ? (
              <Text style={{ color: t.colors.muted, marginTop: 2 }}>Status: {item.status}</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
