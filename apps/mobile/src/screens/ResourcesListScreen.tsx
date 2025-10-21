// apps/mobile/src/screens/ResourcesListScreen.tsx
import React from "react";
import { View, FlatList, Text, Pressable, TextInput, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { listObjects } from "../api/client";
import type { components } from "../api/generated-types";
import { useColors } from "../features/_shared/useColors";

type Resource = components["schemas"]["Resource"];

export default function ResourcesListScreen({ navigation }: any) {
  const t = useColors();
  const [items, setItems] = React.useState<Resource[]>([]);
  const [search, setSearch] = React.useState("");
  const [filterType, setFilterType] = React.useState<string | undefined>(undefined);
  const [next, setNext] = React.useState<string | undefined>(undefined);
  const [pulling, setPulling] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(
    async (reset = false) => {
      setLoading(true);
      const page = await listObjects<Resource>("resource", {
        limit: 30,
        q: search || undefined,
        resourceType: filterType || undefined,
        next: reset ? undefined : next,
        by: "updatedAt",
        sort: "desc",
      } as any);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setNext(page.next);
      setLoading(false);
    },
    [search, filterType, next]
  );

  useFocusEffect(
    React.useCallback(() => {
      load(true);
      return () => {};
    }, [load])
  );

  const onRefresh = React.useCallback(async () => {
    setPulling(true);
    await load(true);
    setPulling(false);
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: 12, borderBottomWidth: 1, borderColor: t.colors.border }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search resources"
          placeholderTextColor={t.colors.textMuted}
          onSubmitEditing={() => load(true)}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            color: t.colors.text,
          }}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        refreshControl={
          <RefreshControl tintColor={t.colors.text} refreshing={pulling} onRefresh={onRefresh} />
        }
        onEndReached={() => next && !loading && load(false)}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("ResourceDetail", { id: item.id, mode: "edit" })}
            style={{ padding: 12, borderBottomWidth: 1, borderColor: t.colors.border }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "600" }}>{item.name}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>
              {item.resourceType} · {item.status}
            </Text>
          </Pressable>
        )}
      />

      <Pressable
        onPress={() => navigation.navigate("ResourceDetail", { mode: "new" })}
        style={{
          position: "absolute",
          right: 20,
          bottom: 30,
          backgroundColor: t.colors.primary,
          paddingHorizontal: 20,
          paddingVertical: 14,
          borderRadius: 24,
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
