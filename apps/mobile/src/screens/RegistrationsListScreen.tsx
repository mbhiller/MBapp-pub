import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackScreenProps } from "../navigation/types";
import { Fab } from "../ui/Fab";
import { listRegistrations, createRegistration, type Registration } from "../features/events/api";

type Props = RootStackScreenProps<"RegistrationsList">;

export default function RegistrationsListScreen({ route }: Props) {
  const t = useTheme();
  const eventId = route?.params?.eventId!;
  const eventName = route?.params?.eventName;

  const [items, setItems] = useState<Registration[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newAccountId, setNewAccountId] = useState("");

  const load = useCallback(async (reset = false) => {
    try {
      setErr(null);
      setLoading(true);
      const r = await listRegistrations(eventId, reset ? undefined : next);
      setItems(reset ? r.items : [...items, ...r.items]);
      setNext(r.next);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [eventId, next, items]);

  useFocusEffect(useCallback(() => { load(true); }, [eventId]));

  async function addRegistration() {
    if (!newAccountId.trim()) return Alert.alert("Missing", "Enter an accountId");
    try {
      await createRegistration(eventId, { accountId: newAccountId.trim(), status: "pending" });
      setNewAccountId("");
      load(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || String(e));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg, padding: 12 }}>
      <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>
        Registrations for {eventName || eventId}
      </Text>
      {loading && items.length === 0 ? <ActivityIndicator /> : null}
      {err ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{err}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        onEndReached={() => next && load(false)}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: t.colors.card, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.colors.border }}>
            <Text style={{ fontWeight: "700", color: t.colors.text }}>{item.accountId ?? "(no accountId)"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>status: {item.status ?? "pending"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </View>
        )}
      />

      {/* Simple inline create */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <TextInput
          value={newAccountId}
          onChangeText={setNewAccountId}
          placeholder="accountId…"
          style={{ flex: 1, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card, padding: 10, borderRadius: 10, color: t.colors.text }}
        />
        <TouchableOpacity onPress={addRegistration} style={{ paddingHorizontal: 16, justifyContent: "center", borderRadius: 10, backgroundColor: t.colors.primary }}>
          <Text style={{ color: t.colors.headerText, fontWeight: "700" }}>Add</Text>
        </TouchableOpacity>
      </View>

      <Fab label="Top" onPress={() => { /* no-op: placeholder for future filter */ }} style={{ bottom: 24 }} />
    </View>
  );
}
