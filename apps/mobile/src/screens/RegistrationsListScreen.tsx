// apps/mobile/src/screens/RegistrationsListScreen.tsx
import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, Alert, Modal } from "react-native";
import { useRegistrations, useCreateRegistration } from "../features/registrations/hooks";
import { useTheme } from "../providers/ThemeProvider";
import type { CreateRegistrationInput } from "../features/registrations/api";

export default function RegistrationsListScreen() {
  const t = useTheme();
  const [q, setQ] = React.useState("");
  const [showCreate, setShowCreate] = React.useState(false);
  
  const { data, isLoading, refetch } = useRegistrations({ q: q || undefined });

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
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
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const division = (item as any).division as string | undefined;
            const klass = (item as any).class as string | undefined;
            
            return (
              <View
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  borderRadius: 8,
                  marginBottom: 8,
                  backgroundColor: t.colors.card,
                }}
              >
                <Text style={{ fontWeight: "600", color: t.colors.text, marginBottom: 4 }}>
                  {item.id}
                </Text>
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
                <Text style={{ fontSize: 12, color: t.colors.textMuted, marginTop: 4 }}>
                  Updated: {new Date(item.updatedAt).toLocaleDateString()}
                </Text>
              </View>
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
