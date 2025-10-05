// apps/mobile/src/screens/ResourceDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { createObject, updateObject, getObject } from "../api/client";
import DateTimeField from "../features/_shared/DateTimeField";
import type { components } from "../api/generated-types";
import type { RootStackParamList } from "../navigation/types";
import FormScreen from "../features/_shared/FormScreen";

type Resource = components["schemas"]["Resource"];
type Route = RouteProp<RootStackParamList, "ResourceDetail">;

export default function ResourceDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const id = params?.id;
  const isNew = params?.mode === "new" || !id;
  const initial = (params?.initial ?? {}) as Partial<Resource>;
  const t = useColors();

  const [item, setItem] = React.useState<Resource | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState(String(initial?.name ?? ""));
  const [code, setCode] = React.useState(String((initial as any)?.code ?? ""));
  const [url, setUrl] = React.useState(String((initial as any)?.url ?? ""));
  const [expiresAt, setExpiresAt] = React.useState<string | undefined>((initial as any)?.expiresAt ?? undefined);

  const load = React.useCallback(async () => {
    if (!id || isNew) return;
    const obj = await getObject<Resource>("resource", String(id));
    setItem(obj);
  }, [id, isNew]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!item) return;
    setName((v) => v || String((item as any)?.name ?? ""));
    setCode((v) => v || String((item as any)?.code ?? ""));
    setUrl((v) => v || String((item as any)?.url ?? ""));
    setExpiresAt((v) => v || (item as any)?.expiresAt);
  }, [item]);

  async function onCreate() {
    if (!name.trim()) { Alert.alert("Name is required"); return; }
    setSaving(true);
    try {
      await createObject<Resource>("resource", {
        type: "resource",
        name: name.trim(),
        code: code.trim() || undefined,
        url: url.trim() || undefined,
        expiresAt,
      } as any);
      navigation.goBack();
    } catch (e: any) { Alert.alert("Error", e?.message ?? "Failed to create"); }
    finally { setSaving(false); }
  }

  async function onSaveEdits() {
    if (!id) return;
    setSaving(true);
    try {
      await updateObject<Resource>("resource", String(id), {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      } as any);
      navigation.goBack();
    } catch (e: any) { Alert.alert("Error", e?.message ?? "Failed to save"); }
    finally { setSaving(false); }
  }

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        {/* Quick link to reservations for this resource (only when editing) */}
        {!isNew && id ? (
          <Pressable
            onPress={() => navigation.navigate("ReservationsList", { resourceId: id })}
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
            <Text style={{ color: t.colors.text, fontWeight: "700" }}>View reservations</Text>
          </Pressable>
        ) : null}

        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="Code"   value={code} onChangeText={setCode} />
        <Field label="URL"    value={url}  onChangeText={setUrl} keyboardType="url" />
        <DateTimeField label="Expires at" value={expiresAt} onChange={setExpiresAt} mode="datetime" />

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
