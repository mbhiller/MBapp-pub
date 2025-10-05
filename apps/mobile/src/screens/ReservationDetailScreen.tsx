// apps/mobile/src/screens/ReservationDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { createObject, updateObject, getObject } from "../api/client";
import DateTimeField from "../features/_shared/DateTimeField";
import type { components } from "../api/generated-types";
import type { RootStackParamList } from "../navigation/types";
import FormScreen from "../features/_shared/FormScreen";

type Reservation = components["schemas"]["Reservation"];
type Route = RouteProp<RootStackParamList, "ReservationDetail">;

const STATUS_VALUES = ["tentative","confirmed","cancelled"] as const;
type ResStatus = typeof STATUS_VALUES[number];

export default function ReservationDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const id = params?.id;
  const mode: "new" | "edit" | undefined = (params as any)?.mode;
  const isNew = mode === "new" || !id;
  const initial = (params?.initial ?? {}) as Partial<Reservation>;
  const t = useColors();

  const [item, setItem] = React.useState<Reservation | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [name, setName]           = React.useState(String((initial as any)?.name ?? ""));
  const [resourceId, setResourceId] = React.useState(String((initial as any)?.resourceId ?? ""));
  const [clientId, setClientId]   = React.useState(String((initial as any)?.clientId ?? ""));
  const [startsAt, setStartsAt]   = React.useState<string | undefined>((initial as any)?.startsAt ?? undefined);
  const [endsAt, setEndsAt]       = React.useState<string | undefined>((initial as any)?.endsAt ?? undefined);
  const [status, setStatus]       = React.useState<string>(String((initial as any)?.status ?? "tentative"));
  const [notes, setNotes]         = React.useState(String((initial as any)?.notes ?? ""));

  const statusTouched = React.useRef(false);

  const load = React.useCallback(async () => {
    if (!id || isNew) return;
    const obj = await getObject<Reservation>("reservation", String(id));
    setItem(obj);
  }, [id, isNew]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!item) return;
    setName((v)        => v || String((item as any)?.name ?? ""));
    setResourceId((v)  => v || String((item as any)?.resourceId ?? ""));
    setClientId((v)    => v || String((item as any)?.clientId ?? ""));
    if (!startsAt && (item as any)?.startsAt) setStartsAt((item as any).startsAt);
    if (!endsAt && (item as any)?.endsAt) setEndsAt((item as any).endsAt);
    if (!statusTouched.current) setStatus(String((item as any)?.status ?? "tentative"));
    setNotes((v)       => v || String((item as any)?.notes ?? ""));
  }, [item]);

  async function onCreate() {
    if (!resourceId.trim()) { Alert.alert("Resource ID is required"); return; }
    setSaving(true);
    try {
      await createObject<Reservation>("reservation", {
        type: "reservation",
        name: name.trim() || undefined,
        resourceId: resourceId.trim(),
        clientId: clientId.trim() || undefined,
        startsAt, endsAt,
        status: (STATUS_VALUES as unknown as string[]).includes(status) ? status as ResStatus : "tentative",
        notes: notes.trim() || undefined,
      } as any);
      navigation.goBack();
    } catch (e: any) { Alert.alert("Error", e?.message ?? "Failed to create"); }
    finally { setSaving(false); }
  }

  async function onSaveEdits() {
    if (!id) return;
    setSaving(true);
    try {
      await updateObject<Reservation>("reservation", String(id), {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(resourceId.trim() ? { resourceId: resourceId.trim() } : {}),
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(startsAt ? { startsAt } : {}),
        ...(endsAt ? { endsAt } : {}),
        ...(status ? { status } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      } as any);
      navigation.goBack();
    } catch (e: any) { Alert.alert("Error", e?.message ?? "Failed to save"); }
    finally { setSaving(false); }
  }

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        {/* Quick link to resource (edit mode only) */}
        {!isNew && id && !!resourceId ? (
          <Pressable
            onPress={() => navigation.navigate("ResourceDetail", { id: resourceId, mode: "edit" })}
            style={{ marginBottom: 12, backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "700" }}>Open resource</Text>
          </Pressable>
        ) : null}

        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Resource ID *" value={resourceId} onChangeText={setResourceId} />
        <Field label="Client ID" value={clientId} onChangeText={setClientId} />

        <DateTimeField label="Starts at" value={startsAt} onChange={setStartsAt} mode="datetime" />
        <DateTimeField label="Ends at"   value={endsAt}   onChange={setEndsAt}   mode="datetime" />

        <Label text="Status" />
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable
          onPress={isNew ? onCreate : onSaveEdits}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
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
        returnKeyType="done"
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: multiline ? 80 : undefined }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}
function PillGroup({ options, value, onChange }:{ options: string[]; value?: string; onChange: (v: string) => void; }) {
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
