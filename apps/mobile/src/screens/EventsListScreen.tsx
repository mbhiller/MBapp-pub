// apps/mobile/src/screens/EventsListScreen.tsx
import * as React from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listEvents, createEvent } from "../features/events/api";
import type { Event } from "../features/events/types";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";

const PAGE_SIZE = 20;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function EventsListScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [items, setItems] = React.useState<Event[]>([]);
  const [next, setNext] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [seedMessage, setSeedMessage] = React.useState<string | null>(null);
  const [isSeeding, setIsSeeding] = React.useState(false);

  React.useEffect(() => {
    void load();
  }, [q]);

  const load = async () => {
    setIsLoading(true);
    setLastError(null);
    try {
      const page = await listEvents({ limit: PAGE_SIZE, q: q || undefined });
      setItems(page.items || []);
      setNext(page.next || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      setItems([]);
      setNext(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!next || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await listEvents({ limit: PAGE_SIZE, next, q: q || undefined });
      setItems((prev) => [...prev, ...(page.items || [])]);
      setNext(page.next || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  const seedEvent = async () => {
    setIsSeeding(true);
    setSeedMessage(null);
    try {
      const now = new Date();
      const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2 hours
      await createEvent({
        name: "Seed Event - Dev",
        status: "scheduled",
        startsAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
        location: "Dev",
      });
      setSeedMessage("✓ Event created");
      // Reset search and reload list
      setQ("");
      setItems([]);
      setNext(null);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSeedMessage(`✗ Failed to create event: ${msg}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const renderItem = ({ item }: { item: Event }) => {
    const title = (item as any).name || item.id || "(no name)";
    const status = (item as any).status || "draft";
    const startsAt = formatDateTime((item as any).startsAt);
    const createdRaw = (item as any).createdAt as string | undefined;
    const updatedRaw = (item as any).updatedAt as string | undefined;
    const created = formatDateTime(createdRaw);
    const updated = formatDateTime(updatedRaw);
    
    const isNew = (() => {
      if (!createdRaw) return false;
      const ts = new Date(createdRaw).getTime();
      if (isNaN(ts)) return false;
      return Date.now() - ts < 10 * 60 * 1000; // 10 minutes
    })();

    return (
      <Pressable
        onPress={() => navigation.navigate("EventDetail", { id: item.id })}
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          marginBottom: 8,
          backgroundColor: t.colors.card,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <Text style={{ color: t.colors.text, fontWeight: "700" }}>
            {title}
          </Text>
          {isNew && (
            <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: t.colors.primary }}>
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
            </View>
          )}
        </View>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 2 }}>Status: {status}</Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Starts: {startsAt || "—"}</Text>
        {createdRaw && <Text style={{ color: t.colors.textMuted, fontSize: 11, marginTop: 4 }}>Created: {created}</Text>}
        {updatedRaw && <Text style={{ color: t.colors.textMuted, fontSize: 11 }}>Updated: {updated}</Text>}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {lastError && (
        <View
          style={{
            padding: 8,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 2 }}>
            Error loading events
          </Text>
          <Text style={{ color: "#8a1f2d", fontSize: 12 }}>{lastError}</Text>
        </View>
      )}

      {__DEV__ && (
        <View style={{ marginBottom: 12, flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Pressable
            onPress={seedEvent}
            disabled={isSeeding}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: isSeeding ? "#ccc" : "#4CAF50",
              borderRadius: 6,
              flex: 1,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>
              {isSeeding ? "Seeding..." : "Seed Event"}
            </Text>
          </Pressable>
          {seedMessage && (
            <Text
              style={{
                fontSize: 11,
                color: seedMessage.startsWith("✓") ? "#4CAF50" : "#d32f2f",
                flex: 1,
              }}
            >
              {seedMessage}
            </Text>
          )}
        </View>
      )}

      {/* Search Input */}
      <TextInput
        placeholder="Search events (id, name, location)"
        placeholderTextColor={t.colors.textMuted}
        value={q}
        onChangeText={setQ}
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
          backgroundColor: t.colors.card,
          color: t.colors.text,
        }}
      />

      {isLoading && items.length === 0 ? (
        <ActivityIndicator size="large" color={t.colors.primary} />
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: t.colors.textMuted }}>No events found</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? (
              <ActivityIndicator size="small" color={t.colors.primary} style={{ marginTop: 8 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}
