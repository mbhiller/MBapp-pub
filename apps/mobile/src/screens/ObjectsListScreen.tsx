// apps/mobile/src/screens/ObjectsListScreen.tsx
import React from "react";
import { View, FlatList, Text, Pressable, TextInput, RefreshControl } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { listObjects } from "../api/client";

export default function ObjectsListScreen({ navigation }: any) {
  const t = useColors();
  const [items, setItems] = React.useState<any[]>([]);
  const [pulling, setPulling] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const load = React.useCallback(async () => {
    const page = await listObjects<any>("object", { by: "updatedAt", sort: "desc", limit: 50 });
    setItems(page.items ?? []);
  }, []);
  useRefetchOnFocus(load);

  const onPull = React.useCallback(async () => { setPulling(true); try { await load(); } finally { setPulling(false); } }, [load]);

  const filtered = items.filter((o) => !search.trim() || (o.type ?? "").toLowerCase().includes(search.toLowerCase()) || (o.id ?? "").toLowerCase().includes(search.toLowerCase()));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <View style={{ marginBottom: 10 }}>
        <TextInput placeholder="Search objects…" placeholderTextColor={t.colors.muted} value={search} onChangeText={setSearch}
          style={{ backgroundColor: t.colors.card, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }}/>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(i, idx)=> String(i.id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("ObjectDetail", { type: item.type, id: item.id })}
            style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, marginBottom: 10, padding: 12 }}>
            <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>{item.type} · {item.id}</Text>
          </Pressable>
        )}
        contentContainerStyle={{ paddingBottom: 72 }}
        onLayout={load}
      />
      <Pressable onPress={() => navigation.navigate("ObjectDetail", { type: "product" })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}>
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
