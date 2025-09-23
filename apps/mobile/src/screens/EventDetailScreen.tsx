// apps/mobile/src/screens/EventDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Events } from "../features/events/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import DateTimeField from "../features/_shared/DateTimeField";
import { useRegistrationsCount } from "../features/registrations/useRegistrationsCount";
import type { Event } from "../features/events/types";

const STATUS_VALUES = ["available", "unavailable", "maintenance"] as const;
type Status = typeof STATUS_VALUES[number];

export default function EventDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Event> & { notes?: string };

  const { data, refetch, isFetching } = Events.useGet(id);
  const create = Events.useCreate();
  const update = Events.useUpdate(id ?? "");

  // Controlled local state
  const [name, setName] = React.useState(String(initial?.name ?? ""));
  const [description, setDescription] = React.useState(String((initial as any)?.description ?? ""));
  const [location, setLocation] = React.useState(String((initial as any)?.location ?? ""));
  const [startsAt, setStartsAt] = React.useState<string | undefined>((initial as any)?.startsAt ?? undefined);
  const [endsAt, setEndsAt] = React.useState<string | undefined>((initial as any)?.endsAt ?? undefined);
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "available"));
  const [capacity, setCapacity] = React.useState(String((initial as any)?.capacity ?? ""));
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));

  // Registrations count
  const countsQ = useRegistrationsCount(id ? [id] : [], { enabled: Boolean(id) });
  const regCount = id ? (countsQ.data?.[id] ?? 0) : 0;

  // Track if the user has edited status this session
  const statusTouched = React.useRef(false);

  // ✨ On focus: just refetch; DON'T clear fields (prevents losing hydration when returning)
  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      if (id) refetch();
    }, [id, refetch])
  );

  // Merge fresh server data into any still-empty fields; status hydrates unless user typed
  React.useEffect(() => {
    if (!data) return;

    if (name === "") setName(String(data?.name ?? ""));
    if (description === "") setDescription(String((data as any)?.description ?? ""));
    if (location === "") setLocation(String((data as any)?.location ?? ""));
    if (!startsAt && (data as any)?.startsAt) setStartsAt((data as any).startsAt);
    if (!endsAt && (data as any)?.endsAt) setEndsAt((data as any).endsAt);

    const serverStatus = String((data as any)?.status ?? "available");
    if (!statusTouched.current) setStatus(serverStatus);

    if (capacity === "") {
      const cap = (data as any)?.capacity;
      setCapacity(cap != null ? String(cap) : "");
    }
    if (notes === "") setNotes(String((data as any)?.notes ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onSave = async () => {
    if (!name.trim()) { Alert.alert("Name is required"); return; }

    // Coerce status to enum on save
    const normalized = (status ?? "").trim().toLowerCase();
    const statusEnum: Status = (STATUS_VALUES as readonly string[]).includes(normalized as Status)
      ? (normalized as Status)
      : "available";

    const capNum = capacity.trim() === "" ? undefined : Number.parseInt(capacity, 10);
    const capacityClean = Number.isFinite(capNum as number) ? (capNum as number) : undefined;

    const payload: Partial<Event> & { notes?: string } = {
      id,
      type: "event",
      name: name.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      startsAt, endsAt,
      status: statusEnum,
      ...(capacityClean != null ? { capacity: capacityClean } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };

    try {
      if (id) await update.mutateAsync(payload as any);
      else     await create.mutateAsync(payload as any);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    }
  };

  return (
    <FormScreen>
      <View
        style={{
          backgroundColor: t.colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: 16,
          marginBottom: 12,
        }}
      >
        {/* 🔝 View registrations at top */}
        {id && (
          <Pressable
            onPress={() => navigation.navigate("RegistrationsList", { eventId: id })}
            style={{
              marginBottom: 12,
              backgroundColor: t.colors.card,
              borderColor: t.colors.border,
              borderWidth: 1,
              borderRadius: 10,
              padding: 12,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "700" }}>View registrations</Text>
            <View
              style={{
                minWidth: 28,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: t.colors.primary,
                alignItems: "center",
              }}
            >
              <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
                {countsQ.isLoading ? "…" : regCount}
              </Text>
            </View>
          </Pressable>
        )}

        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="Description" value={description} onChangeText={setDescription} multiline />
        <Field label="Location" value={location} onChangeText={setLocation} />

        <DateTimeField label="Starts at" value={startsAt} onChange={setStartsAt} mode="datetime" />
        <DateTimeField label="Ends at" value={endsAt} onChange={setEndsAt} mode="datetime" />

        {/* Status as selectable pill buttons */}
        <Label text='Status'/>
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Field label="Capacity" value={capacity} onChangeText={setCapacity} keyboardType="numeric" />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable
          onPress={onSave}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {id ? (isFetching ? "Saving…" : "Save") : "Create"}
          </Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}

function Field({
  label, value, onChangeText, multiline, keyboardType,
}:{
  label: string; value?: any; onChangeText: (v: any) => void; multiline?: boolean; keyboardType?: any;
}) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ marginBottom: 6, color: t.colors.muted }}>{label}</Text>
      <TextInput
        value={String(value ?? "")}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        returnKeyType="done"
        style={{
          backgroundColor: t.colors.bg,
          color: t.colors.text,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}

function PillGroup({
  options,
  value,
  onChange,
}: {
  options: string[];
  value?: string;
  onChange: (v: string) => void;
}) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: selected ? t.colors.primary : t.colors.border,
              backgroundColor: selected ? t.colors.primary : t.colors.card,
              marginRight: 8,
              marginBottom: 8,
            }}
          >
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
