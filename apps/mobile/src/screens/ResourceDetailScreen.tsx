import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Resources } from "../features/resources/hooks";
import { useColors } from "../providers/useColors";

export default function ResourceDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const t = useColors();
  const { data, isLoading } = Resources.useGet(id);
  const update = id ? Resources.useUpdate(id) : undefined;
  const create = Resources.useCreate();

  const [name, setName] = React.useState("");
  const [resourceType, setResourceType] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [location, setLocation] = React.useState("");

  React.useEffect(() => {
    setName((data as any)?.name ?? "");
    setResourceType((data as any)?.resourceType ?? "");
    setStatus((data as any)?.status ?? "");
    setLocation((data as any)?.location ?? "");
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload: any = {
        name,
        resourceType: resourceType || undefined,
        status: status || undefined,
        location: location || undefined,
      };
      if (id && update) {
        await update.mutateAsync(payload);
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        navigation.navigate("ResourcesList");
      }
    } catch (e: any) {
      console.warn("Save failed:", e?.message || e);
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  if (id && isLoading) return <View style={{ padding: 16 }}><Text style={{ color: t.colors.muted }}>Loading…</Text></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 16 }}>
      <LabeledInput label="Name" value={name} onChangeText={setName} />
      <LabeledInput label="Type (stall/arena/rv/equipment/room)" value={resourceType} onChangeText={setResourceType} />
      <LabeledInput label="Status (available/unavailable/maintenance)" value={status} onChangeText={setStatus} />
      <LabeledInput label="Location" value={location} onChangeText={setLocation} />
      <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
    </ScrollView>
  );
}

function LabeledInput(props: any) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>{props.label}</Text>
      <TextInput {...props}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text, backgroundColor: t.colors.card }} />
    </View>
  );
}
function PrimaryButton({ title, onPress, disabled }: any) {
  const t = useColors();
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={{ backgroundColor: disabled ? t.colors.disabled : t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center", marginTop: 4 }}>
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}
