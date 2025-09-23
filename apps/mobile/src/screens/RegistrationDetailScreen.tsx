import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Registrations } from "../features/registrations/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import DateTimeField from "../features/_shared/DateTimeField";
import type { Registration } from "../features/registrations/types";

const STATUS_VALUES = ["pending","confirmed","cancelled","checked_in","completed"] as const;
type RStatus = typeof STATUS_VALUES[number];

export default function RegistrationDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Registration>;

  const q = Registrations.useGet(id);
  const save = Registrations.useSave();

  const [eventId, setEventId] = React.useState(String((initial as any)?.eventId ?? ""));
  const [clientId, setClientId] = React.useState(String((initial as any)?.clientId ?? ""));
  const [startsAt, setStartsAt] = React.useState<string | undefined>((initial as any)?.startsAt ?? undefined);
  const [endsAt, setEndsAt] = React.useState<string | undefined>((initial as any)?.endsAt ?? undefined);
  const [registeredAt, setRegisteredAt] = React.useState<string | undefined>((initial as any)?.registeredAt ?? undefined);
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "pending"));
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));

  const statusTouched = React.useRef(false);

  useFocusEffect(React.useCallback(() => {
    statusTouched.current = false;
    if (id) q.refetch();
  }, [id, q.refetch]));

  React.useEffect(() => {
    const data = q.data as Registration | undefined;
    if (!data) return;

    if (eventId === "") setEventId(String((data as any)?.eventId ?? ""));
    if (clientId === "") setClientId(String((data as any)?.clientId ?? ""));
    if (!startsAt && (data as any)?.startsAt) setStartsAt((data as any).startsAt);
    if (!endsAt && (data as any)?.endsAt) setEndsAt((data as any).endsAt);
    if (!registeredAt && (data as any)?.registeredAt) setRegisteredAt((data as any).registeredAt);

    const serverStatus = String((data as any)?.status ?? "pending");
    if (!statusTouched.current) setStatus(serverStatus);

    if (notes === "") setNotes(String((data as any)?.notes ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const onSave = async () => {
    if (!eventId.trim()) { Alert.alert("eventId is required"); return; }

    const normalized = (status ?? "").trim();
    const statusEnum: RStatus = (STATUS_VALUES as readonly string[]).includes(normalized as RStatus)
      ? (normalized as RStatus)
      : "pending";

    const payload: Partial<Registration> = {
      id, type: "registration",
      eventId: eventId.trim(),
      clientId: clientId.trim() || undefined,
      startsAt, endsAt, registeredAt,
      status: statusEnum as any,
      notes: notes.trim() || undefined,
    };

    try {
      await save.mutateAsync(payload as any);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    }
  };

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        <Field label="Event ID *" value={eventId} onChangeText={setEventId} />
        <Field label="Client ID" value={clientId} onChangeText={setClientId} />

        <DateTimeField label="Starts at" value={startsAt} onChange={setStartsAt} mode="datetime" />
        <DateTimeField label="Ends at" value={endsAt} onChange={setEndsAt} mode="datetime" />
        <DateTimeField label="Registered at" value={registeredAt} onChange={setRegisteredAt} mode="datetime" />

        <Label text="Status" />
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable onPress={onSave}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{id ? "Save" : "Create"}</Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}
function Field({ label, value, onChangeText, multiline, keyboardType }:{
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
          backgroundColor: t.colors.bg, color: t.colors.text,
          borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12,
          minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}
function PillGroup({ options, value, onChange }: { options: string[]; value?: string; onChange: (v: string) => void; }) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.primary : t.colors.card, marginRight: 8, marginBottom: 8,
          }}>
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
