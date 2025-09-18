import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import { useColors } from "../providers/useColors";

export default function RegistrationDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const t = useColors();
  const { data, isLoading } = Registrations.useGet(id);
  const update = id ? Registrations.useUpdate(id) : undefined;
  const create = Registrations.useCreate();

  const [eventId, setEventId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    setEventId((data as any)?.eventId ?? "");
    setClientId((data as any)?.clientId ?? "");
    setQty((data as any)?.qty != null ? String((data as any)?.qty) : "");
    setStatus((data as any)?.status ?? "");
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload: any = {
        eventId: eventId || undefined,
        clientId: clientId || undefined,
        qty: qty ? Number(qty) : undefined,
        status: status || undefined,
      };
      if (id && update) {
        await update.mutateAsync(payload);
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        navigation.navigate("RegistrationsList");
      }
    } catch (e: any) {
      console.warn("Save failed:", e?.message || e);
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  if (id && isLoading) return <View style={{ padding: 16 }}><Text style={{ color: t.colors.muted }}>Loading…</Text></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 16 }}>
      <LabeledInput label="Event ID" value={eventId} onChangeText={setEventId} />
      <LabeledInput label="Client ID" value={clientId} onChangeText={setClientId} />
      <LabeledInput label="Qty" value={qty} onChangeText={setQty} keyboardType="number-pad" />
      <LabeledInput label="Status" value={status} onChangeText={setStatus} />
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
