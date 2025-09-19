import React from "react";
import { ScrollView, Text, TextInput, Pressable, Alert } from "react-native";
import { ObjectsAPI } from "../features/objects/api";
import { useColors } from "../providers/useColors";

export default function ObjectDetailScreen({ route, navigation }: any) {
  const type: string = route?.params?.type ?? "client";
  const id: string | undefined = route?.params?.id;
  const t = useColors();

  const [loading, setLoading] = React.useState(Boolean(id));
  const [saving, setSaving] = React.useState(false);
  const [jsonText, setJsonText] = React.useState("{}");

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!id) { setLoading(false); return; }
      try {
        const obj = await ObjectsAPI.get(type, id);
        if (!mounted) return;
        setJsonText(JSON.stringify(obj, null, 2));
      } finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [id, type]);

  const onSave = async () => {
    setSaving(true);
    try {
      const body = JSON.parse(jsonText || "{}");
      if (id) {
        await ObjectsAPI.update(type, id, body);
        navigation.goBack();
      } else {
        await ObjectsAPI.create(type, body);
        navigation.navigate("ObjectsList");
      }
    } catch (e: any) {
      console.warn("Save failed:", e?.message || e);
      Alert.alert("Save failed", e?.message ?? "Invalid JSON or server error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Text style={{ color: t.colors.muted, padding: 16 }}>Loading…</Text>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 16 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>{type} JSON</Text>
      <TextInput
        value={jsonText}
        onChangeText={setJsonText}
        multiline
        numberOfLines={16}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text, backgroundColor: t.colors.card, minHeight: 280 }}
      />
      <Pressable
        onPress={onSave}
        style={{ backgroundColor: saving ? t.colors.disabled : t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center", marginTop: 12 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{saving ? "Saving…" : "Save"}</Text>
      </Pressable>
    </ScrollView>
  );
}
