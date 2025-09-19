import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import type { Registration } from "../features/registrations/types";
import { useColors } from "../providers/useColors";

export default function RegistrationDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const presetEventId: string | undefined = route?.params?.eventId; // from Events → Registrations
  const isCreate = !id;

  const { data, isLoading } = Registrations.useGet(id);
  const update = id ? Registrations.useUpdate(id) : undefined;
  const create = Registrations.useCreate();

  const [name, setName] = React.useState("");
  const [eventId, setEventId] = React.useState<string | undefined>(presetEventId);
  const [clientId, setClientId] = React.useState<string | undefined>(undefined);
  const [status, setStatus] = React.useState<string | undefined>(undefined);
  const [notes, setNotes] = React.useState<string | undefined>(undefined);

  // hydrate
  React.useEffect(() => {
    if (isCreate && !data) {
      setName("");
      setEventId(presetEventId); // lock in the routed eventId for new
      setClientId(undefined);
      setStatus(undefined);
      setNotes(undefined);
      return;
    }
    if (data) {
      setName(data?.name ?? "");
      setEventId(data?.eventId);
      setClientId(data?.clientId ?? data?.accountId);
      setStatus(data?.status);
      setNotes(data?.notes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload: Partial<Registration> = {
        name: name?.trim() || undefined,
        eventId: eventId, // keep as-is; required for linking
        clientId: clientId?.trim() || undefined,
        status: status?.trim() || undefined,
        notes: notes?.trim() || undefined,
      };
      if (id && update) {
        await update.mutateAsync(payload);
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        // return to list; preserve the event filter if present
        navigation.navigate("RegistrationsList", { eventId });
      }
    } catch (e: any) {
      console.warn("Save failed:", e?.message || e);
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  if (id && isLoading) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: t.colors.muted }}>Loading…</Text>
      </View>
    );
  }

  const textBox = {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    padding: 10,
    color: t.colors.text,
    backgroundColor: t.colors.card,
  } as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 16 }}>
      <Labeled label="Name">
        <TextInput value={name} onChangeText={setName} style={textBox} />
      </Labeled>

      {/* EventId: if prefilled from EventDetail, render read-only */}
      <Labeled label="Event">
        {presetEventId && isCreate ? (
          <View
            style={{
              ...textBox,
              paddingVertical: 12,
            }}
          >
            <Text style={{ color: t.colors.text }}>
              {eventId ?? "(none)"}
            </Text>
            <Text style={{ color: t.colors.muted, marginTop: 4, fontSize: 12 }}>
              Linked from Event
            </Text>
          </View>
        ) : (
          <TextInput
            value={eventId ?? ""}
            onChangeText={(v) => setEventId(v || undefined)}
            style={textBox}
            placeholder="eventId"
            autoCapitalize="none"
          />
        )}
      </Labeled>

      <Labeled label="Client (Account) ID">
        <TextInput
          value={clientId ?? ""}
          onChangeText={(v) => setClientId(v || undefined)}
          style={textBox}
          placeholder="clientId / accountId"
          autoCapitalize="none"
        />
      </Labeled>

      <Labeled label="Status">
        <TextInput
          value={status ?? ""}
          onChangeText={(v) => setStatus(v || undefined)}
          style={textBox}
          autoCapitalize="none"
        />
      </Labeled>

      <Labeled label="Notes">
        <TextInput
          value={notes ?? ""}
          onChangeText={(v) => setNotes(v || undefined)}
          style={[textBox, { minHeight: 80 }]}
          multiline
        />
      </Labeled>

      <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
    </ScrollView>
  );
}

function Labeled({ label, children }: React.PropsWithChildren<{ label: string }>) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}
function PrimaryButton({ title, onPress, disabled }: any) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: disabled ? t.colors.disabled : t.colors.primary,
        padding: 14,
        borderRadius: 10,
        alignItems: "center",
        marginTop: 4,
      }}
    >
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}
