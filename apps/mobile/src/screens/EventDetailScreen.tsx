import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Events } from "../features/events/hooks";
import { useColors } from "../providers/useColors";

function isoOrEmpty(d?: Date) {
  return d ? d.toISOString() : "";
}
function parseISO(s?: string) {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export default function EventDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const isCreate = !id;

  const t = useColors();
  const { data, isLoading } = Events.useGet(id);
  const update = id ? Events.useUpdate(id) : undefined;
  const create = Events.useCreate();

  // form state
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("");

  const [startAt, setStartAt] = React.useState<Date | undefined>(undefined);
  const [endAt, setEndAt] = React.useState<Date | undefined>(undefined);

  // hydrate once per-load
  React.useEffect(() => {
    if (isCreate && !data) {
      setName("");
      setLocation("");
      setStartAt(undefined);
      setEndAt(undefined);
      return;
    }
    if (data) {
      setName(data?.name ?? "");
      setLocation(data?.location ?? "");
      setStartAt(parseISO(data?.startDate));
      setEndAt(parseISO(data?.endDate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload = {
        name: name?.trim() || undefined,
        location: location?.trim() || undefined,
        startDate: isoOrEmpty(startAt) || undefined,
        endDate: isoOrEmpty(endAt) || undefined,
      };
      if (id && update) {
        await update.mutateAsync(payload);
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        navigation.navigate("EventsList");
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

      <Labeled label="Start">
        <DateTimePicker
          value={startAt ?? new Date()}
          mode="datetime"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(_, d) => d && setStartAt(d)}
        />
        {/* ISO preview */}
        <Text style={{ color: t.colors.muted, marginTop: 6 }}>{isoOrEmpty(startAt) || "—"}</Text>
      </Labeled>

      <Labeled label="End">
        <DateTimePicker
          value={endAt ?? (startAt ?? new Date())}
          mode="datetime"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(_, d) => d && setEndAt(d)}
        />
        <Text style={{ color: t.colors.muted, marginTop: 6 }}>{isoOrEmpty(endAt) || "—"}</Text>
      </Labeled>

      <Labeled label="Location">
        <TextInput value={location} onChangeText={setLocation} style={textBox} />
      </Labeled>

      {/* NEW: Link to registrations for this event (only on edit mode) */}
      {!isCreate && (
        <Pressable
          onPress={() => navigation.navigate("RegistrationsList", { eventId: id })}
          style={{
            padding: 12,
            borderRadius: 10,
            alignItems: "center",
            marginTop: 8,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
          }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>View Registrations</Text>
        </Pressable>
      )}

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
