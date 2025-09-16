import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackScreenProps } from "../navigation/types";
import { Fab } from "../ui/Fab";
import { listRegistrations, createRegistration, type Registration, listEvents, type Event } from "../features/events/api";
import { useInfiniteQuery, type InfiniteData, useQuery } from "@tanstack/react-query";

type Props = RootStackScreenProps<"RegistrationsList">;

type RegPage = { items: Registration[]; next?: string };

export default function RegistrationsListScreen({ route, navigation }: Props) {
  const t = useTheme();
  const eventId = route?.params?.eventId;
  const eventName = route?.params?.eventName;

  // If no eventId, show a quick picker of events
  if (!eventId) {
    const evq = useQuery<{ items: Event[]; next?: string }, Error>({
      queryKey: ["events", "for-picker"],
      queryFn: () => listEvents({ next: undefined }),
    });

    if (evq.isLoading) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
          <ActivityIndicator />
        </View>
      );
    }

    const events = evq.data?.items ?? [];
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg, padding: 12 }}>
        <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>Choose an event</Text>
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => navigation.replace("RegistrationsList", { eventId: item.id, eventName: item.name })}
              style={{ backgroundColor: t.colors.card, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.colors.border }}
            >
              <Text style={{ fontWeight: "700", color: t.colors.text }}>{item.name || "(no name)"}</Text>
              <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={{ color: t.colors.textMuted }}>No events found.</Text>}
        />
      </View>
    );
  }

  // Normal registrations list for a specific event
  const listRef = useRef<FlatList<Registration>>(null);
  const [newAccountId, setNewAccountId] = useState("");

  const q = useInfiniteQuery<
    RegPage, Error, InfiniteData<RegPage>, ["registrations", string], string | undefined
  >({
    queryKey: ["registrations", eventId],
    queryFn: ({ pageParam }) => listRegistrations(eventId, pageParam),
    getNextPageParam: (last) => last?.next ?? undefined,
    initialPageParam: undefined,
  });

  useFocusEffect(useCallback(() => { q.refetch(); }, []));
  const items = q.data?.pages.flatMap(p => p?.items ?? []) ?? [];

  async function addRegistration() {
    const eid = eventId;
    if (!eid) return Alert.alert("Missing", "No eventId available.");
    if (!newAccountId.trim()) return Alert.alert("Missing", "Enter an accountId");
    try {
      await createRegistration(eid, { accountId: newAccountId.trim(), status: "pending" });
      setNewAccountId("");
      q.refetch();
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (e: any) {
      Alert.alert("Error", e?.message || String(e));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg, padding: 12 }}>
      <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>
        Registrations for {eventName || eventId}
      </Text>

      {q.isLoading && items.length === 0 ? <ActivityIndicator /> : null}
      {q.isError ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{q.error.message}</Text> : null}

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(it) => it.id}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        refreshing={q.isRefetching || q.isFetching}
        onRefresh={() => q.refetch()}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("RegistrationDetail", { id: item.id })}
            style={{ backgroundColor: t.colors.card, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.colors.border }}
          >
            <Text style={{ fontWeight: "700", color: t.colors.text }}>{item.accountId ?? "(no accountId)"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>status: {item.status ?? "pending"}</Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />

      {/* Simple inline create */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <TextInput
          value={newAccountId}
          onChangeText={setNewAccountId}
          placeholder="accountId…"
          placeholderTextColor={t.colors.textMuted}
          style={{
            flex: 1, borderWidth: 1, borderColor: t.colors.border,
            backgroundColor: t.colors.card, padding: 10, borderRadius: 10, color: t.colors.text,
          }}
          autoCapitalize="none"
        />
        <TouchableOpacity
          onPress={addRegistration}
          style={{ paddingHorizontal: 16, justifyContent: "center", borderRadius: 10, backgroundColor: t.colors.primary }}
        >
          <Text style={{ color: t.colors.headerText, fontWeight: "700" }}>Add</Text>
        </TouchableOpacity>
      </View>

      <Fab
        label="Top"
        onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
        style={{ bottom: 96 }}
      />
    </View>
  );
}
