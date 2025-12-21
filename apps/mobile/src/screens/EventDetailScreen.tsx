// apps/mobile/src/screens/EventDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, ScrollView, Pressable, FlatList } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { getEvent } from "../features/events/api";
import { listRegistrations } from "../features/registrations/api";
import type { Registration } from "../features/registrations/types";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";
import { FEATURE_REGISTRATIONS_ENABLED } from "../features/_shared/flags";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RoutePropType = RouteProp<RootStackParamList, "EventDetail">;

export default function EventDetailScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();

  const eventId = route.params?.id;
  const [event, setEvent] = React.useState<any | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [lastError, setLastError] = React.useState<string | null>(null);

  // Registrations section
  const [registrations, setRegistrations] = React.useState<Registration[]>([]);
  const [regIsLoading, setRegIsLoading] = React.useState(false);
  const [regError, setRegError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void load();
  }, [eventId]);

  const load = async () => {
    if (!eventId) {
      setLastError("No event id provided");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLastError(null);
    try {
      const res = await getEvent(eventId);
      setEvent(res);
      // Load registrations for this event (only if feature enabled)
      if (FEATURE_REGISTRATIONS_ENABLED) {
        await loadRegistrations(eventId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      setEvent(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadRegistrations = async (evtId: string) => {
    setRegIsLoading(true);
    setRegError(null);
    try {
      // Fetch a reasonable limit of registrations, then filter client-side
      const page = await listRegistrations({ limit: 100 });
      const filtered = (page.items || []).filter((r) => (r as any).eventId === evtId);
      setRegistrations(filtered.slice(0, 20)); // limit to 20 displayed
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setRegError(msg);
      setRegistrations([]);
    } finally {
      setRegIsLoading(false);
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  const renderField = (label: string, value: any) => {
    const display = value === null || value === undefined || value === "" ? "—" : String(value);
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>{label}</Text>
        <Text style={{ fontSize: 14, color: t.colors.text, fontWeight: "500" }}>{display}</Text>
      </View>
    );
  };

  const renderRegistrationRow = ({ item }: { item: Registration }) => {
    const partyId = (item as any).partyId || item.id || "(no party)";
    const status = (item as any).status || "draft";

    return (
      <Pressable
        onPress={() => navigation.navigate("RegistrationDetail", { id: item.id })}
        style={{
          padding: 10,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 6,
          marginBottom: 6,
          backgroundColor: t.colors.card,
        }}
      >
        <Text style={{ color: t.colors.text, fontWeight: "600", marginBottom: 2 }}>
          {partyId}
        </Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Status: {status}</Text>
      </Pressable>
    );
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  if (lastError || !event) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: t.colors.bg }}>
        <View
          style={{
            padding: 10,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 4 }}>
            Error loading event
          </Text>
          <Text style={{ color: "#8a1f2d" }}>{lastError || "Event not found"}</Text>
        </View>
        <Pressable
          onPress={load}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: t.colors.primary,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, padding: 16, backgroundColor: t.colors.bg }}>
      {/* Event Details Section */}
      {renderField("Name", event.name)}
      {renderField("Status", event.status)}
      {renderField("Location", event.location)}
      {renderField("Starts At", formatDateTime(event.startsAt))}
      {renderField("Ends At", formatDateTime(event.endsAt))}
      {renderField("Capacity", event.capacity)}
      {renderField("Description", event.description)}
      {renderField("Notes", event.notes)}

      {/* Registrations Section */}
      <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.colors.border }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: t.colors.text, marginBottom: 12 }}>
          Registrations
        </Text>

        {!FEATURE_REGISTRATIONS_ENABLED ? (
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Registrations are disabled</Text>
        ) : regError && regError.toLowerCase().includes("disabled") ? (
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Registrations are disabled</Text>
        ) : regError ? (
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
            <Text style={{ color: "#8a1f2d", fontSize: 12 }}>{regError}</Text>
          </View>
        ) : regIsLoading ? (
          <ActivityIndicator size="small" color={t.colors.primary} />
        ) : registrations.length === 0 ? (
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>No registrations for this event</Text>
        ) : (
          <FlatList
            scrollEnabled={false}
            data={registrations}
            keyExtractor={(item) => item.id}
            renderItem={renderRegistrationRow}
          />
        )}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
