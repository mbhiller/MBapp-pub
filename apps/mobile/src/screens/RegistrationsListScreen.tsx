import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function RegistrationsListScreen({ navigation, route }: any) {
  const t = useColors();
  const eventId: string | undefined = route?.params?.eventId;
  const { data, isLoading, refetch } = Registrations.useList({ limit: 20, eventId });
  useRefetchOnFocus(() => refetch());
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 8 }}>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("RegistrationDetail", { id: item.id })} style={{ padding: 12 }}>
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>{`Registration ${item.id}`}</Text>
            <Text style={{ color: t.colors.muted, marginTop: 2 }}>{`eventId: ${item.eventId}${item.status ? ` • ${item.status}` : ""}`}</Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.colors.border }} />}
      />
      <Pressable
        onPress={() => navigation.navigate("RegistrationDetail", { id: undefined })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
