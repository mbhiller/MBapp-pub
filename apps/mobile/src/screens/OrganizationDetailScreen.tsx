import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { createObject, updateObject, getObject } from "../api/client";
import type { components } from "../api/generated-types";
import type { RootStackParamList } from "../navigation/types";
import FormScreen from "../features/_shared/FormScreen";

type Organization = components["schemas"]["Organization"];
type Route = RouteProp<RootStackParamList, "OrganizationDetail">;

const STATUS_VALUES = ["active", "inactive", "archived"] as const;
const KIND_VALUES   = ["club", "federation", "venueOp", "sponsor"] as const;

export default function OrganizationDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const id = params?.id;
  const isNew = params?.mode === "new" || !id;
  const initial = (params?.initial ?? {}) as Partial<Organization>;
  const t = useColors();

  const [item, setItem] = React.useState<Organization | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState(String(initial?.name ?? ""));
  const [kind, setKind] = React.useState<string>(String((initial as any)?.kind ?? "club"));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "active"));
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));

  const load = React.useCallback(async () => {
    if (!id || isNew) return;
    const obj = await getObject<Organization>("organization", String(id));
    setItem(obj);
  }, [id, isNew]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!item) return;
    setName((v) => v || String((item as any)?.name ?? ""));
    setKind((v) => v || String((item as any)?.kind ?? "club"));
    setStatus((v) => v || String((item as any)?.status ?? "active"));
    setNotes((v) => v || String((item as any)?.notes ?? ""));
  }, [item]);

  async function onCreate() {
    if (!name.trim()) { Alert.alert("Name is required"); return; }
    setSaving(true);
    try {
      await createObject<Organization>("organization", {
        type: "organization",
        name: name.trim(),
        kind: (KIND_VALUES as unknown as string[]).includes(kind) ? kind : "club",
        status: (STATUS_VALUES as unknown as string[]).includes(status) ? status : "active",
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
      await updateObject<Organization>("organization", String(id), {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(kind ? { kind } : {}),
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
        <Field label="Name *" value={name} onChangeText={setName} />

        <Label text="Kind" />
        <PillGroup options={KIND_VALUES as unknown as string[]} value={kind} onChange={setKind} />

        <Label text="Status" />
        <PillGroup options={STATUS_VALUES as unknown as string[]} value={status} onChange={setStatus} />

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
        blurOnSubmit={false}
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
