import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Clients } from "../features/clients/hooks";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function ClientsListScreen({ navigation }: any) {
  const t = useColors();
  const { data, isLoading, refetch } = Clients.useList({ limit: 20 });
  useRefetchOnFocus(() => refetch());
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 8 }}>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("ClientDetail", { id: item.id })} style={{ padding: 12 }}>
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>
              {item.name || "(no name)"}
            </Text>
            <Text style={{ color: t.colors.muted, marginTop: 2 }}>{item.email || item.id}</Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.colors.border }} />}
      />
      <Pressable
        onPress={() => navigation.navigate("ClientDetail", { id: undefined })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
