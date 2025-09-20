import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import { useColors } from "../providers/useColors";

function iso(d?: string) { return d ? new Date(d).toLocaleString() : "—"; }

export default function RegistrationDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const passedEventId: string | undefined = route?.params?.eventId;
  const isCreate = !id;

  const t = useColors();
  const get = Registrations.useGet(id);
  const create = Registrations.useCreate();
  const update = id ? Registrations.useUpdate(id) : undefined;

  const [eventId, setEventId] = React.useState(passedEventId ?? "");
  const [clientId, setClientId] = React.useState("");
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (isCreate) {
      setEventId(passedEventId ?? "");
      setClientId(""); setName(""); setStatus(""); setNotes("");
      return;
    }
    if (get.data) {
      setEventId(get.data.eventId ?? passedEventId ?? "");
      setClientId(get.data.clientId ?? "");
      setName(get.data.name ?? "");
      setStatus(get.data.status ?? "");
      setNotes(get.data.notes ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get.data?.id, passedEventId]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    const payload = {
      eventId: (eventId || "").trim() || undefined,
      clientId: (clientId || "").trim() || undefined,
      name: (name || "").trim() || undefined,
      status: (status || "").trim() || undefined,
      notes: (notes || "").trim() || undefined,
    };
    if (!payload.eventId) {
      Alert.alert("Validation", "eventId is required.");
      return;
    }
    try {
      if (id && update) {
        await update.mutateAsync(payload);
        Alert.alert("Saved", "Registration updated.");
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        Alert.alert("Saved", "Registration created.");
        // return to the list for this event (if present)
        navigation.navigate("RegistrationsList", { eventId: payload.eventId });
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.colors.text,
    backgroundColor: t.colors.background,
  } as const;

  if (id && get.isLoading) {
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.colors.background }}>
        <Text style={{ color: t.colors.muted }}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Card>
        <SectionTitle title={isCreate ? "New Registration" : "Edit Registration"} />

        {/* If we were deep-linked from an event, show eventId read-only */}
        {passedEventId ? (
          <Labeled label="Event">
            <View style={{ paddingVertical: 10 }}>
              <Text style={{ color: t.colors.text, fontWeight: "700" }}>{passedEventId}</Text>
            </View>
          </Labeled>
        ) : (
          <Labeled label="Event Id">
            <TextInput
              value={eventId}
              onChangeText={setEventId}
              placeholder="event id"
              placeholderTextColor={t.colors.muted}
              style={inputStyle}
              autoCapitalize="none"
            />
          </Labeled>
        )}

        <Labeled label="Client Id">
          <TextInput
            value={clientId}
            onChangeText={setClientId}
            placeholder="client id"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            autoCapitalize="none"
          />
        </Labeled>

        <Labeled label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Attendee name"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
          />
        </Labeled>

        <Labeled label="Status">
          <TextInput
            value={status}
            onChangeText={setStatus}
            placeholder="e.g. confirmed, canceled, waitlist"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            autoCapitalize="none"
          />
        </Labeled>

        <Labeled label="Notes">
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="notes"
            placeholderTextColor={t.colors.muted}
            style={[inputStyle, { minHeight: 80 }]}
            multiline
          />
        </Labeled>

        {!isCreate && (
          <View style={{ marginTop: 6 }}>
            <Text style={{ color: t.colors.muted, fontSize: 12 }}>
              Created: {iso(get.data?.createdAt)} • Updated: {iso(get.data?.updatedAt)}
            </Text>
          </View>
        )}

        <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
      </Card>
    </ScrollView>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const t = useColors();
  return (
    <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16, gap: 12 }}>
      {children}
    </View>
  );
}
function SectionTitle({ title }: { title: string }) {
  const t = useColors();
  return <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>{title}</Text>;
}
function Labeled({ label, children }: React.PropsWithChildren<{ label: string }>) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 10 }}>
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
