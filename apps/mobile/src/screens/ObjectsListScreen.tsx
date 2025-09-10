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
import { toastFromError } from "../lib/errors";
import { Screen } from "../ui/Screen";
import { Section } from "../ui/Section";
import { NonProdBadge } from "../ui/NonProdBadge";
import { useTheme } from "../ui/ThemeProvider";

type Item = {
  id: string;
  type?: string;
  name?: string;
  data?: any;
  tags?: Record<string, any>;
  createdAt?: number | string;
  updatedAt?: number | string;
  [k: string]: any;
};

const fmt = (v?: number | string) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !isFinite(n)) return "—";
  try {
    return new Date(n).toLocaleString();
  } catch {
    return "—";
  }
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

// Adjust to the types you care about
const TYPES = ["horse", "dog", "cattle"];

export default function ObjectsListScreen({ route, navigation }: any) {
  const t = useTheme();
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
          const r = await listObjects(type, { limit: 20, name: query.trim() || undefined });
          setItems(r.items ?? []);
          setCursor(r.nextCursor);
        } catch (e: any) {
          const msg = e?.message || "Failed to load";
          setError(msg);
          toastFromError(e, "Load failed");
        } finally {
          setLoading(false);
        }
      } else {
        if (!cursor || loading) return;
        setLoading(true);
        try {
          const r = await listObjects(type, { limit: 20, cursor, name: query.trim() || undefined });
          setItems((prev) => [...prev, ...(r.items ?? [])]);
          setCursor(r.nextCursor);
        } finally {
          setLoading(false);
        }
      }
    },
    [type, cursor, loading, query]
  );

  useEffect(() => {
    setItems([]);
    setCursor(undefined);
    setQuery("");
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const r = await listObjects(type, { limit: 20, name: query.trim() || undefined });
      setItems(r.items ?? []);
      setCursor(r.nextCursor);
    } catch (e: any) {
      const msg = e?.message || "Failed to refresh";
      setError(msg);
      toastFromError(e, "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [type, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const fields = [
        it.name,
        it.id,
        it.data?.name,
        it.data?.title,
        it.tags?.rfidEpc,
        it.tags?.friendlyName,
      ]
        .filter(Boolean)
        .map(String);
      return fields.some((s) => s.toLowerCase().includes(q));
    });
  }, [items, query]);

  const onPress = (item: Item) => {
    navigation.navigate("ObjectDetail", { obj: { ...item, type } });
  };
  const onLongPress = (item: Item) => {
    navigation.navigate("Scan", { attachTo: { id: item.id, type } });
  };

  const Row = ({ item }: { item: Item }) => (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={300}
      style={({ pressed }) => ({
        padding: 14,
        backgroundColor: pressed ? "#f8fafc" : t.card,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      })}
    >
      <Text style={{ fontWeight: "800", color: t.text }}>{titleOf(item, type)}</Text>

      <Text selectable numberOfLines={1} style={{ color: t.textMuted, marginTop: 2 }}>
        ID: <Text style={{ color: t.text }}>{item.id}</Text>
      </Text>

      <Text style={{ color: t.textMuted, marginTop: 2 }}>
        Created: {fmt(item.createdAt)}   Updated: {fmt(item.updatedAt)}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6, gap: 8 }}>
        {item.tags?.rfidEpc ? (
          <Badge text={`EPC ${item.tags.rfidEpc}`} tone="success" />
        ) : null}
        {item.tags?.archived ? <Badge text="Archived" tone="danger" /> : null}
      </View>
    </Pressable>
  );

  const Chip = ({ value }: { value: string }) => {
    const active = value === type;
    return (
      <Pressable
        onPress={() => setType(value)}
        style={{
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 16,
          marginRight: 8,
          borderWidth: 1,
          borderColor: active ? t.text : t.border,
          backgroundColor: active ? "#eef2ff" : t.card,
        }}
      >
        <Text style={{ fontWeight: active ? "800" : "600", color: t.text }}>{value}</Text>
      </Pressable>
    );
  };

  const header = (
    <Section label="Browse" style={{ marginTop: 8 }}>
      {/* Type selector */}
      <View style={{ flexDirection: "row", marginBottom: 10 }}>
        {TYPES.map((tp) => (
          <Chip key={tp} value={tp} />
        ))}
      </View>

      {/* Search */}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name, ID, EPC…"
        placeholderTextColor={t.textMuted}
        style={{
          backgroundColor: "#fff",
          borderWidth: 1,
          borderColor: t.border,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 10,
          color: t.text,
        }}
      />

      {/* Meta + errors */}
      <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.textMuted }}>
          {filtered.length}/{items.length} shown{cursor ? " • more available…" : ""}
        </Text>
        {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
      </View>

      <Text style={{ color: t.textMuted, marginTop: 6 }}>
        Tip: long-press an item to Scan & attach an EPC directly.
      </Text>
    </Section>
  );

  return (
    <Screen title="Objects" scroll={false}>
      {/* Non-prod badge */}
      <View style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
        <NonProdBadge />
      </View>

      {header}

      <View style={{ flex: 1, marginHorizontal: 12, backgroundColor: t.card, borderRadius: t.radius, overflow: "hidden", borderWidth: 1, borderColor: t.border }}>
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => <Row item={item} />}
          onEndReachedThreshold={0.3}
          onEndReached={() => load(false)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListFooterComponent={
            <View style={{ padding: 12, alignItems: "center" }}>
              {loading ? (
                <ActivityIndicator />
              ) : filtered.length === 0 ? (
                <Text style={{ color: t.textMuted }}>No items</Text>
              ) : null}
            </View>
          }
          contentContainerStyle={{ minHeight: "100%" }}
        />
      </View>
    </Screen>
  );
}

function Badge({ text, tone }: { text: string; tone?: "success" | "danger" | "info" }) {
  const t = useTheme();
  const bg =
    tone === "success" ? "#dcfce7" :
    tone === "danger"  ? "#fee2e2" :
                         "#e5e7eb";
  const fg =
    tone === "success" ? t.success :
    tone === "danger"  ? t.danger  :
                         t.textMuted;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
      <Text style={{ color: fg, fontWeight: "700", fontSize: 12 }}>{text}</Text>
    </View>
  );
}
