import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackScreenProps } from "../navigation/types";
import { Fab } from "../ui/Fab";
import { listEvents, type Event } from "../features/events/api";

type Props = RootStackScreenProps<"EventsList">;

export default function EventsListScreen({ navigation }: Props) {
  const t = useTheme();
  const [items, setItems] = useState<Event[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (reset = false) => {
    try {
      setErr(null);
      setLoading(true);
      const r = await listEvents(reset ? undefined : { next });
      setItems(reset ? r.items : [...items, ...r.items]);
      setNext(r.next);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [next, items]);

  useFocusEffect(useCallback(() => { load(true); }, []));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg, padding: 12 }}>
      {loading && items.length === 0 ? <ActivityIndicator /> : null}
      {err ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{err}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        onEndReached={() => next && load(false)}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("EventDetail", { id: item.id })}
            style={{ backgroundColor: t.colors.card, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.colors.border }}
          >
            <Text style={{ fontWeight: "700", color: t.colors.text }}>{item.name || "(no name)"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.startsAt ?? "unscheduled"} → {item.endsAt ?? "—"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />
      <Fab label="New Event" onPress={() => navigation.navigate("EventDetail", { mode: "new" })} />
    </View>
  );
}
