import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Reservations } from "../features/reservations/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import DateTimeField from "../features/_shared/DateTimeField";
import type { Reservation } from "../features/reservations/types";
import { cancelReservation, startReservation, endReservation } from "../features/reservations/actions";

const STATUS_VALUES = ["pending","confirmed","in_use","completed","cancelled"] as const;
type VStatus = typeof STATUS_VALUES[number];

export default function ReservationDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Reservation>;

  const q = Reservations.useGet(id);
  const save = Reservations.useSave();

  const [resourceId, setResourceId] = React.useState(String((initial as any)?.resourceId ?? ""));
  const [clientId, setClientId] = React.useState(String((initial as any)?.clientId ?? ""));
  const [clientName, setClientName] = React.useState(String((initial as any)?.clientName ?? ""));
  const [startsAt, setStartsAt] = React.useState<string | undefined>((initial as any)?.startsAt ?? (initial as any)?.start ?? undefined);
  const [endsAt, setEndsAt] = React.useState<string | undefined>((initial as any)?.endsAt ?? (initial as any)?.end ?? undefined);
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "pending"));
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));

  const statusTouched = React.useRef(false);

  useFocusEffect(React.useCallback(() => {
    statusTouched.current = false;
    if (id) q.refetch();
  }, [id, q.refetch]));

  React.useEffect(() => {
    const data = q.data as Reservation | undefined;
    if (!data) return;

    if (resourceId === "") setResourceId(String((data as any)?.resourceId ?? ""));
    if (clientId === "") setClientId(String((data as any)?.clientId ?? ""));
    if (clientName === "") setClientName(String((data as any)?.clientName ?? ""));
    if (!startsAt && ((data as any)?.startsAt || (data as any)?.start)) setStartsAt((data as any).startsAt ?? (data as any).start);
    if (!endsAt && ((data as any)?.endsAt || (data as any)?.end)) setEndsAt((data as any).endsAt ?? (data as any).end);

    const serverStatus = String((data as any)?.status ?? "pending");
    if (!statusTouched.current) setStatus(serverStatus);

    if (notes === "") setNotes(String((data as any)?.notes ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const onSave = async () => {
    if (!resourceId.trim()) { Alert.alert("resourceId is required"); return; }
    const normalized = (status ?? "").trim();
    const statusEnum = (STATUS_VALUES as unknown as string[]).includes(normalized) ? normalized : "pending";

    const payload: Partial<Reservation> = {
      id,
      type: "reservation" as any,
      resourceId: resourceId.trim(),
      clientId: clientId.trim() || undefined,
      clientName: clientName.trim() || undefined,
      startsAt: startsAt || undefined,
      endsAt: endsAt || undefined,
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

  const canStart = !!id && (status === "pending" || status === "confirmed");
  const canEnd   = !!id && (status === "in_use" || status === "pending" || status === "confirmed");
  const canCancel= !!id && (status !== "cancelled" && status !== "completed");

  const run = async (label: string, fn: () => Promise<any>) => {
    try { await fn(); await q.refetch(); Alert.alert(label, "Success"); }
    catch (e: any) { Alert.alert(label, e?.message ?? "Action failed"); }
  };

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        <Field label="Resource ID *" value={resourceId} onChangeText={setResourceId} />
        <Field label="Client ID" value={clientId} onChangeText={setClientId} />
        <Field label="Client Name" value={clientName} onChangeText={setClientName} />

        <DateTimeField label="Starts at" value={startsAt} onChange={setStartsAt} mode="datetime" />
        <DateTimeField label="Ends at" value={endsAt} onChange={setEndsAt} mode="datetime" />

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
              {canStart  && <SmallBtn label="Start"  onPress={() => run("Start",  () => startReservation(String(id)))} />}
              {canEnd    && <SmallBtn label="End"    onPress={() => run("End",    () => endReservation(String(id)))} />}
              {canCancel && <SmallBtn label="Cancel" onPress={() => run("Cancel", () => cancelReservation(String(id)))} />}
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
