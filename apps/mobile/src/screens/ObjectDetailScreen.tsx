// apps/mobile/src/screens/ObjectDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import { getObject, createObject } from "../api/client";

export default function ObjectDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const type: string = route?.params?.type ?? "object";
  const id: string | undefined = route?.params?.id;

  const [value, setValue] = React.useState<string>("{}");
  const [loading, setLoading] = React.useState<boolean>(!!id);

  React.useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const obj = await getObject<any>(type, id);
        setValue(JSON.stringify(obj, null, 2));
      } catch (e) { /* ignore */ } finally { setLoading(false); }
    })();
  }, [id, type]);

  const onSave = async () => {
    try {
      const parsed = JSON.parse(value);
      const saved = await createObject<any>(type, { ...parsed, type });
      navigation.replace("ObjectDetail", { type, id: saved.id });
    } catch (e:any) {
      Alert.alert("Error", e?.message ?? "Invalid JSON or failed to save");
    }
  };

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        <Text style={{ color: t.colors.muted, marginBottom: 8 }}>{id ? `${type} • ${id}` : `New ${type}`}</Text>
        <TextInput value={value} onChangeText={setValue} multiline editable={!loading}
          style={{ minHeight: 280, backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12 }}
          placeholderTextColor={t.colors.muted}/>
        <Pressable onPress={onSave} disabled={loading}
          style={{ marginTop: 12, backgroundColor: loading ? t.colors.disabled : t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>Save</Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}
