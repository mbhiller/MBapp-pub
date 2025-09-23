import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Resources } from "../features/resources/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import DateTimeField from "../features/_shared/DateTimeField";
import type { Resource } from "../features/resources/types";

export default function ResourceDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Resource>;

  const { data, refetch, isFetching } = Resources.useGet(id);
  const save = Resources.useSave();

  const [name, setName] = React.useState(String((initial as any)?.name ?? ""));
  const [code, setCode] = React.useState(String((initial as any)?.code ?? ""));
  const [url, setUrl] = React.useState(String((initial as any)?.url ?? ""));
  const [expiresAt, setExpiresAt] = React.useState<string | undefined>((initial as any)?.expiresAt ?? undefined);

  useFocusEffect(React.useCallback(() => { if (id) refetch(); }, [id, refetch]));

  React.useEffect(() => {
    if (!data) return;
    const d = data as Resource;

    if (name === "") setName(String((d as any)?.name ?? ""));
    if (code === "") setCode(String((d as any)?.code ?? ""));
    if (url === "") setUrl(String((d as any)?.url ?? ""));
    if (!expiresAt && (d as any)?.expiresAt) setExpiresAt((d as any).expiresAt);
  }, [data]);

  const onSave = async () => {
    if (!name.trim()) { Alert.alert("Name is required"); return; }

    const payload: Partial<Resource> = {
      id, type: "resource",
      name: name.trim(),
      code: code.trim() || undefined,
      url: url.trim() || undefined,
      expiresAt,
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
        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="Code" value={code} onChangeText={setCode} />
        <Field label="URL" value={url} onChangeText={setUrl} />
        <DateTimeField label="Expires at" value={expiresAt} onChange={setExpiresAt} mode="date" />

        <Pressable onPress={onSave} style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{id ? (isFetching ? "Saving…" : "Save") : "Create"}</Text>
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
        blurOnSubmit={false}
        returnKeyType="done"
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: multiline ? 80 : undefined }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}
