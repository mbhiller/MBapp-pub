import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Clients } from "../features/clients/hooks";
import { useColors } from "../providers/useColors";

export default function ClientDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const t = useColors();
  const { data, isLoading } = Clients.useGet(id);
  const update = id ? Clients.useUpdate(id) : undefined;
  const create = Clients.useCreate();

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");

  React.useEffect(() => {
    setName(data?.name ?? "");
    setEmail(data?.email ?? "");
    setPhone(data?.phone ?? "");
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload = { name, email, phone };
      if (id && update) {
        await update.mutateAsync(payload);
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        navigation.navigate("ClientsList");
      }
    } catch (e: any) {
      console.warn("Save failed:", e?.message || e);
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  if (id && isLoading) {
    return <View style={{ padding: 16 }}><Text style={{ color: t.colors.muted }}>Loading…</Text></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 16 }}>
      <LabeledInput label="Name" value={name} onChangeText={setName} />
      <LabeledInput label="Email" value={email} onChangeText={setEmail} />
      <LabeledInput label="Phone" value={phone} onChangeText={setPhone} />
      <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
    </ScrollView>
  );
}

function LabeledInput({ label, value, onChangeText, ...rest }: any) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        {...rest}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text, backgroundColor: t.colors.card }}
      />
    </View>
  );
}
function PrimaryButton({ title, onPress, disabled }: any) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{ backgroundColor: disabled ? t.colors.disabled : t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center", marginTop: 4 }}
    >
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}
