import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, TouchableOpacity, View } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { api } from "../api/client";

type Obj = { id: string; type: string; name?: string; [k: string]: any };

export default function ObjectsListScreen({ navigation, route }: RootStackScreenProps<"Objects">) {
  const type = (route?.params?.type || "horse") as string;

  const [items, setItems] = useState<Obj[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const data = await api.objects.list({ type, limit: 25 });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [type]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const header = useMemo(() => (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 12, opacity: 0.7, color: "#333" }}>TYPE</Text>
      <Text style={{ fontSize: 18, fontWeight: "700", color: "#111", marginTop: 4 }}>{type}</Text>
      <Text style={{ fontSize: 12, opacity: 0.7, color: "#333", marginTop: 12 }}>RESULTS</Text>
      {err ? <Text style={{ color: "crimson", marginTop: 8 }}>{err}</Text> : null}
    </View>
  ), [type, err]);

  if (loading && !refreshing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: "#333" }}>Loading {type}…</Text>
        {err ? <Text style={{ marginTop: 6, color: "crimson" }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f7f7f7" }}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("ObjectDetail", { id: item.id, type: item.type })}
            style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#eee", backgroundColor: "#fff" }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: "#111" }}>{item.name || "(unnamed)"}</Text>
            <Text style={{ opacity: 0.7, marginTop: 2, color: "#333" }}>
              {item.type} · {item.id}
            </Text>
          </TouchableOpacity>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#333" />}
        ListEmptyComponent={
          <Text style={{ opacity: 0.6, paddingVertical: 24, paddingHorizontal: 16, color: "#333" }}>
            No objects found.
          </Text>
        }
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}
