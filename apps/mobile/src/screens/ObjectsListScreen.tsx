import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { listObjects, type MbObject } from "../api/client";
import { useTheme } from "../providers/ThemeProvider";
import { Fab } from "../ui/Fab";

type Props = RootStackScreenProps<"ObjectsList">;

export default function ObjectsListScreen({ navigation, route }: Props) {
  const t = useTheme();
  const type = route.params?.type || "horse";
  const [items, setItems] = useState<MbObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await listObjects(type, { limit: 50, order: "desc" });
      setItems(res.items ?? []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { load(); }, [load]);

  if (loading && items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator />
        {err ? <Text style={{ marginTop: 8, color: t.colors.danger }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 10, backgroundColor: t.colors.bg }}>
      {err ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{err}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(o) => o.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("ObjectDetail", { type, id: item.id })}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
            }}
          >
            <Text style={{ fontWeight: "700" as const, color: t.colors.text }}>{item.name || "(no name)"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />

      {/* For objects, FAB = Scan (keeps pattern consistent and practical) */}
      <Fab label="Scan" onPress={() => navigation.navigate("Scan", { intent: "navigate" })} />
    </View>
  );
}
