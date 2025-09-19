import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Events } from "../features/events/hooks";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function EventsListScreen({ navigation }: any) {
  const t = useColors();
  const { data, isLoading, refetch } = Events.useList({ limit: 20 });
  useRefetchOnFocus(() => refetch());

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 8 }}>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("EventDetail", { id: item.id })} style={{ padding: 12 }}>
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>{item.name || "(no title)"}</Text>
            <Text style={{ color: t.colors.muted, marginTop: 2 }}>
              {item.startDate ? new Date(item.startDate).toLocaleString() : item.id}
            </Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.colors.border }} />}
      />
      <Pressable
        onPress={() => navigation.navigate("EventDetail", { id: undefined })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
