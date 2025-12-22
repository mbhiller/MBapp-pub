// apps/mobile/src/screens/RegistrationsListScreen.tsx
import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, Alert, Modal } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useRegistrations, useCreateRegistration } from "../features/registrations/hooks";
import { createRegistration } from "../features/registrations/api";
import { listEvents, createEvent } from "../features/events/api";
import { findParties, createParty } from "../features/parties/api";
import { FEATURE_REGISTRATIONS_ENABLED } from "../features/_shared/flags";
import { useTheme } from "../providers/ThemeProvider";
import type { CreateRegistrationInput } from "../features/registrations/api";
import type { RootStackParamList } from "../navigation/types";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function RegistrationsListScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [q, setQ] = React.useState("");
  const [showCreate, setShowCreate] = React.useState(false);
  const [isSeeding, setIsSeeding] = React.useState(false);
  const [seedMessage, setSeedMessage] = React.useState<string | null>(null);
  
  const { data, isLoading, error, refetch } = useRegistrations({ q: q || undefined });

  const seedRegistration = async () => {
    if (!FEATURE_REGISTRATIONS_ENABLED) {
      setSeedMessage("Registrations feature is disabled");
      return;
    }
    setIsSeeding(true);
    setSeedMessage(null);
    try {
      let eventId: string | undefined;
      let partyId: string | undefined;

      // Ensure an event exists
      try {
        const evPage = await listEvents({ limit: 1 });
        eventId = evPage.items?.[0]?.id;
      } catch (err) {
        // ignore; we'll try to create
      }
      if (!eventId) {
        const now = new Date();
        const endsAt = new Date(now.getTime() + 60 * 60 * 1000);
        const ev = await createEvent({
          name: "Seed Event - Dev",
          status: "scheduled",
          startsAt: now.toISOString(),
          endsAt: endsAt.toISOString(),
          location: "Dev",
          type: "event" as any,
        });
        eventId = ev.id;
      }

      // Ensure a party exists
      try {
        const parties = await findParties({ q: "", role: undefined as any });
        partyId = parties[0]?.id;
      } catch (err) {
        // ignore; we'll try to create
      }
      if (!partyId) {
        const party = await createParty({ kind: "person", name: "Seed Party - Dev" });
        partyId = party.id;
      }

      if (!eventId || !partyId) {
        setSeedMessage("✗ Seed failed: please seed an event and a party first");
        return;
      }

      await createRegistration({ eventId, partyId, status: "draft" });
      setSeedMessage("✓ Registration created");
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSeedMessage(`✗ Failed to seed: ${msg}`);
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {error && (
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
            Error loading registrations
          </Text>
          <Text style={{ color: "#8a1f2d", fontSize: 12 }}>
            {error instanceof Error ? error.message : String(error)}
          </Text>
        </View>
      )}

      {/* Dev Seed */}
      {__DEV__ && (
        <View style={{ marginBottom: 12, flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Pressable
            onPress={seedRegistration}
            disabled={isSeeding || !FEATURE_REGISTRATIONS_ENABLED}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: isSeeding || !FEATURE_REGISTRATIONS_ENABLED ? "#ccc" : "#4CAF50",
              borderRadius: 6,
              flex: 1,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>
              {isSeeding ? "Seeding..." : "Seed Registration"}
            </Text>
          </Pressable>
          {seedMessage && (
            <Text
              style={{
                fontSize: 11,
                color: seedMessage.startsWith("✓") ? "#4CAF50" : "#d32f2f",
                flex: 1,
              }}
              numberOfLines={2}
            >
              {seedMessage}
            </Text>
          )}
        </View>
      )}

      {/* Search Input */}
      <TextInput
        placeholder="Search registrations (id, party, division, class)"
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

      {/* New Button */}
      <Pressable
        onPress={() => setShowCreate(true)}
        style={{
          backgroundColor: t.colors.primary,
          padding: 12,
          borderRadius: 8,
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>+ New Registration</Text>
      </Pressable>

      {/* List */}
      {isLoading && data.length === 0 ? (
        <ActivityIndicator size="large" color={t.colors.primary} />
      ) : (
        <FlatList
          data={[...data].sort((a, b) => {
            // Primary: createdAt descending
            const aCreated = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
            const bCreated = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
            if (aCreated !== bCreated) return bCreated - aCreated;
            
            // Fallback: updatedAt descending
            const aUpdated = (a as any).updatedAt ? new Date((a as any).updatedAt).getTime() : 0;
            const bUpdated = (b as any).updatedAt ? new Date((b as any).updatedAt).getTime() : 0;
            if (aUpdated !== bUpdated) return bUpdated - aUpdated;
            
            // Final fallback: id descending lexicographically
            return (b.id || "").localeCompare(a.id || "");
          })}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const division = (item as any).division as string | undefined;
            const klass = (item as any).class as string | undefined;
            const createdRaw = (item as any).createdAt as string | undefined;
            const updatedRaw = (item as any).updatedAt as string | undefined;
            
            const formatDateTime = (value?: string) => {
              if (!value) return "";
              const d = new Date(value);
              return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
            };

            const isNew = (() => {
              if (!createdRaw) return false;
              const ts = new Date(createdRaw).getTime();
              if (isNaN(ts)) return false;
              return Date.now() - ts < 10 * 60 * 1000; // 10 minutes
            })();
            
            return (
              <Pressable
                onPress={() => navigation.navigate("RegistrationDetail", { id: item.id })}
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
                  <Text style={{ fontWeight: "600", color: t.colors.text }}>
                    {item.id}
                  </Text>
                  {isNew && (
                    <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: t.colors.primary }}>
                      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 13, color: t.colors.textMuted }}>
                  Party: {item.partyId}
                </Text>
                <Text style={{ fontSize: 13, color: t.colors.textMuted }}>
                  Status: {item.status}
                </Text>
                {division && (
                  <Text style={{ fontSize: 13, color: t.colors.textMuted }}>
                    Division: {division}
                  </Text>
                )}
                {klass && (
                  <Text style={{ fontSize: 13, color: t.colors.textMuted }}>
                    Class: {klass}
                  </Text>
                )}
                {createdRaw && <Text style={{ fontSize: 12, color: t.colors.textMuted, marginTop: 4 }}>Created: {formatDateTime(createdRaw)}</Text>}
                {updatedRaw && <Text style={{ fontSize: 12, color: t.colors.textMuted }}>Updated: {formatDateTime(updatedRaw)}</Text>}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: t.colors.textMuted, marginTop: 20 }}>
              No registrations found
            </Text>
          }
          onRefresh={refetch}
          refreshing={isLoading}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateRegistrationModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            refetch();
          }}
        />
      )}
    </View>
  );
}

type CreateModalProps = {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function CreateRegistrationModal({ visible, onClose, onSuccess }: CreateModalProps) {
  const t = useTheme();
  const [eventId, setEventId] = React.useState("");
  const [partyId, setPartyId] = React.useState("");
  const [division, setDivision] = React.useState("");
  const [classValue, setClassValue] = React.useState("");
  
  const { mutate, isPending } = useCreateRegistration();

  const handleCreate = () => {
    if (!eventId.trim() || !partyId.trim()) {
      Alert.alert("Validation", "Event ID and Party ID are required");
      return;
    }

    const input: CreateRegistrationInput = {
      eventId: eventId.trim(),
      partyId: partyId.trim(),
      status: "draft",
    };

    if (division.trim()) input.division = division.trim();
    if (classValue.trim()) input.class = classValue.trim();

    mutate(input, {
      onSuccess: () => {
        Alert.alert("Success", "Registration created");
        onSuccess();
      },
      onError: (err: any) => {
        Alert.alert("Error", err.message || "Failed to create registration");
      },
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: t.colors.card, borderRadius: 12, padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: t.colors.text, marginBottom: 16 }}>
            New Registration
          </Text>

          <TextInput
            placeholder="Event ID *"
            placeholderTextColor={t.colors.textMuted}
            value={eventId}
            onChangeText={setEventId}
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
              backgroundColor: t.colors.bg,
              color: t.colors.text,
            }}
          />

          <TextInput
            placeholder="Party ID *"
            placeholderTextColor={t.colors.textMuted}
            value={partyId}
            onChangeText={setPartyId}
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
              backgroundColor: t.colors.bg,
              color: t.colors.text,
            }}
          />

          <TextInput
            placeholder="Division (optional)"
            placeholderTextColor={t.colors.textMuted}
            value={division}
            onChangeText={setDivision}
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
              backgroundColor: t.colors.bg,
              color: t.colors.text,
            }}
          />

          <TextInput
            placeholder="Class (optional)"
            placeholderTextColor={t.colors.textMuted}
            value={classValue}
            onChangeText={setClassValue}
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              padding: 10,
              marginBottom: 16,
              backgroundColor: t.colors.bg,
              color: t.colors.text,
            }}
          />

          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable
              onPress={onClose}
              disabled={isPending}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.colors.border,
                alignItems: "center",
              }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "600" }}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={handleCreate}
              disabled={isPending}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 8,
                backgroundColor: isPending ? t.colors.textMuted : t.colors.primary,
                alignItems: "center",
              }}
            >
              {isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700" }}>Create</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
