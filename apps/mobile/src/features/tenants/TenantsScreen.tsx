import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../../providers/ThemeProvider";
import type { RootStackScreenProps } from "../../navigation/types";

type Tenant = {
  id: string;
  name?: string;
  slug?: string;
  [k: string]: any;
};

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ||
  "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";

export default function TenantsScreen({
  navigation,
}: RootStackScreenProps<"Tenants">) {
  const t = useTheme();

  const [items, setItems] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/tenants`, {
        headers: { accept: "application/json" },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.message || resp.statusText);
      setItems(Array.isArray(data?.items) ? data.items : data ?? []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading && !refreshing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: t.colors.textMuted }}>
          Loading tenants…
        </Text>
        {err ? (
          <Text style={{ marginTop: 6, color: t.colors.danger }}>{err}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {err ? (
        <Text
          style={{
            color: t.colors.danger,
            paddingHorizontal: 16,
            paddingTop: 12,
          }}
        >
          {err}
        </Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingVertical: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.text}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("Objects", { type: "horse" }) // adjust if you want tenant detail later
            }
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
              backgroundColor: t.colors.card,
            }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "600" }}>
              {item.name || item.slug || item.id}
            </Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>
              {item.id}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text
            style={{
              opacity: 0.7,
              paddingVertical: 24,
              paddingHorizontal: 16,
              color: t.colors.textMuted,
            }}
          >
            No tenants found.
          </Text>
        }
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}
