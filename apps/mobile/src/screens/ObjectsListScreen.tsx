// apps/mobile/src/screens/ObjectsListScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { listObjects } from "../api/client";

type Item = {
  id: string; type?: string; name?: string; data?: any;
  tags?: Record<string, any>; createdAt?: number | string; updatedAt?: number | string;
  [k: string]: any;
};

const fmt = (v?: number | string) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !isFinite(n)) return "—";
  try { return new Date(n).toLocaleString(); } catch { return "—"; }
};

const titleOf = (it: Item, type: string) => {
  const idTail = it?.id?.slice?.(-6) ?? "";
  return (
    it?.name ??
    it?.data?.name ??
    it?.data?.title ??
    (it?.tags?.friendlyName as string | undefined) ??
    (it?.tags?.rfidEpc ? `EPC ${it.tags.rfidEpc}` : undefined) ??
    `${type}${idTail ? " • " + idTail : ""}`
  );
};

const TYPES = ["horse", "dog", "cattle"]; // tweak to whatever you use

export default function ObjectsListScreen({ route, navigation }: any) {
  const initialType = (route?.params?.type as string) || "horse";

  const [type, setType] = useState<string>(initialType);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(
    async (reset = false) => {
      setError(null);
      if (reset) {
        setLoading(true);
        try {
          const r = await listObjects(type, { limit: 20 });
          setItems(r.items ?? []);
          setCursor(r.nextCursor);
        } catch (e: any) {
          setError(e?.message || "Failed to load");
        } finally {
          setLoading(false);
        }
      } else {
        if (!cursor || loading) return;
        setLoading(true);
        try {
          const r = await listObjects(type, { limit: 20, cursor });
          setItems(prev => [...prev, ...(r.items ?? [])]);
          setCursor(r.nextCursor);
        } finally {
          setLoading(false);
        }
      }
    },
    [type, cursor, loading]
  );

  // initial + whenever type changes
  useEffect(() => {
    setItems([]); setCursor(undefined); setQuery("");
    load(true);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = useCallback(async () => {
    setRefreshing(true); setError(null);
    try {
      const r = await listObjects(type, { limit: 20 });
      setItems(r.items ?? []);
      setCursor(r.nextCursor);
    } catch (e: any) {
      setError(e?.message || "Failed to refresh");
    } finally { setRefreshing(false); }
  }, [type]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it => {
      const fields = [
        it.name,
        it.id,
        it.data?.name,
        it.data?.title,
        it.tags?.rfidEpc,
        it.tags?.friendlyName,
      ].filter(Boolean).map(String);
      return fields.some(s => s.toLowerCase().includes(q));
    });
  }, [items, query]);

  const renderItem = ({ item }: { item: Item }) => (
    <Pressable
      onPress={() => navigation.navigate("ObjectDetail", { obj: { ...item, type } })}
      style={({ pressed }) => ({
        padding: 12,
        backgroundColor: pressed ? "#f5f5f5" : "#fff",
        borderBottomWidth: 1, borderBottomColor: "#eee"
      })}
    >
      <Text style={{ fontWeight: "700" }}>{titleOf(item, type)}</Text>
      <Text selectable numberOfLines={1} style={{ color: "#555" }}>ID: {item.id}</Text>
      <Text style={{ color: "#777", marginTop: 2 }}>
        Created: {fmt(item.createdAt)}   Updated: {fmt(item.updatedAt)}
      </Text>
    </Pressable>
  );

  const Chip = ({ value }: { value: string }) => {
    const active = value === type;
    return (
      <Pressable
        onPress={() => setType(value)}
        style={{
          paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, marginRight: 8,
          borderWidth: 1, borderColor: active ? "#333" : "#ccc",
          backgroundColor: active ? "#e9e9e9" : "#fff"
        }}
      >
        <Text style={{ fontWeight: active ? "700" : "500" }}>{value}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        onEndReachedThreshold={0.3}
        onEndReached={() => load(false)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={{ padding: 16, backgroundColor: "#fafafa" }}>
            {/* Type selector */}
            <View style={{ flexDirection: "row", marginBottom: 10 }}>
              {TYPES.map(t => <Chip key={t} value={t} />)}
            </View>

            {/* Search */}
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, ID, EPC…"
              style={{
                backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd",
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8
              }}
            />

            {/* Meta + errors */}
            <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: "#666" }}>
                {filtered.length}/{items.length} shown{cursor ? " • more available…" : ""}
              </Text>
              {error ? <Text style={{ color: "red" }}>{error}</Text> : null}
            </View>
          </View>
        }
        ListFooterComponent={
          <View style={{ padding: 12, alignItems: "center" }}>
            {loading ? <ActivityIndicator /> : (filtered.length === 0 ? <Text style={{ color: "#666" }}>No items</Text> : null)}
          </View>
        }
        contentContainerStyle={{ backgroundColor: "#fff", minHeight: "100%" }}
      />

      {/* Floating Scan button (FAB) */}
      <Pressable
        onPress={() => navigation.navigate("Scan")}
        style={{
          position: "absolute",
          right: 16,
          bottom: 24,
          backgroundColor: "#111",
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: 24,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 6,
          elevation: 4
        }}
        accessibilityRole="button"
        accessibilityLabel="Scan"
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>Scan</Text>
      </Pressable>
    </View>
  );
}
