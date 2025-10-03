import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Registrations } from "../features/registrations/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import DateTimeField from "../features/_shared/DateTimeField";
import type { Registration } from "../features/registrations/types";
import { cancelRegistration, checkinRegistration, checkoutRegistration } from "../features/registrations/actions";

const STATUS_VALUES = ["pending","confirmed","cancelled","checked_in","checked_out"] as const;
type RStatus = typeof STATUS_VALUES[number];

export default function RegistrationDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Registration>;

  const q = Registrations.useGet(id);
  const save = Registrations.useSave();

  const [eventId, setEventId] = React.useState(String((initial as any)?.eventId ?? ""));
  const [clientId, setClientId] = React.useState(String((initial as any)?.clientId ?? ""));
  const [clientName, setClientName] = React.useState(String((initial as any)?.clientName ?? ""));
  const [qty, setQty] = React.useState(String((initial as any)?.qty ?? "1"));
  const [startsAt, setStartsAt] = React.useState<string | undefined>((initial as any)?.startsAt ?? (initial as any)?.start ?? undefined);
  const [endsAt, setEndsAt] = React.useState<string | undefined>((initial as any)?.endsAt ?? (initial as any)?.end ?? undefined);
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
    if (clientName === "") setClientName(String((data as any)?.clientName ?? ""));
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
    const statusEnum = (STATUS_VALUES as unknown as string[]).includes(normalized) ? normalized : "pending";
    const qtyNum = Math.max(1, Number(qty || 1) || 1);

    const payload: Partial<Registration> = {
      id,
      type: "registration" as any,
      eventId: eventId.trim(),
      clientId: clientId.trim() || undefined,
      clientName: clientName.trim() || undefined,
      qty: qtyNum,
      startsAt: startsAt || undefined,
      endsAt: endsAt || undefined,
      registeredAt: registeredAt || undefined,
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

  const canCheckIn  = !!id && (status === "confirmed");
  const canCheckOut = !!id && (status === "checked_in");
  const canCancel   = !!id && (status !== "cancelled" && status !== "checked_out");

  const run = async (label: string, fn: () => Promise<any>) => {
    try { await fn(); await q.refetch(); Alert.alert(label, "Success"); }
    catch (e: any) { Alert.alert(label, e?.message ?? "Action failed"); }
  };

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        <Field label="Event ID *" value={eventId} onChangeText={setEventId} />
        <Field label="Client ID" value={clientId} onChangeText={setClientId} />
        <Field label="Client Name" value={clientName} onChangeText={setClientName} />
        <Field label="Qty" value={qty} onChangeText={setQty} keyboardType="numeric" />

        <DateTimeField label="Starts at" value={startsAt} onChange={setStartsAt} mode="datetime" />
        <DateTimeField label="Ends at" value={endsAt} onChange={setEndsAt} mode="datetime" />
        <DateTimeField label="Registered at" value={registeredAt} onChange={setRegisteredAt} mode="datetime" />

        <Label text="Status" />
        <PillGroup options={STATUS_VALUES as unknown as string[]} value={status} onChange={(v) => { statusTouched.current = true; setStatus(v); }} />

        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable onPress={onSave}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{id ? "Save" : "Create"}</Text>
        </Pressable>

        {Boolean(id) && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ color: t.colors.muted, marginBottom: 6 }}>Actions</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {canCheckIn  && <SmallBtn label="Check-in"  onPress={() => run("Check-in",  () => checkinRegistration(String(id)))} />}
              {canCheckOut && <SmallBtn label="Check-out" onPress={() => run("Check-out", () => checkoutRegistration(String(id)))} />}
              {canCancel   && <SmallBtn label="Cancel"    onPress={() => run("Cancel",    () => cancelRegistration(String(id)))} />}
            </View>
          </View>
        )}
      </View>
    </FormScreen>
  );
}

function SmallBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useColors();
  return (
    <Pressable onPress={onPress} style={{ marginRight: 8, marginBottom: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}>
      <Text style={{ color: t.colors.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
function Label({ text }: { text: string }) {
  const t = useColors(); return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
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
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: multiline ? 80 : undefined }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}
function PillGroup({ options, value, onChange }:{
  options: string[]; value?: string; onChange: (v: string) => void;
}) {
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
