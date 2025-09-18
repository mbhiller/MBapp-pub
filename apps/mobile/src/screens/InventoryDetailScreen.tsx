import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Inventory } from "../features/inventory/hooks";
import { useColors } from "../providers/useColors";

export default function InventoryDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const t = useColors();
  const { data, isLoading } = Inventory.useGet(id);
  const update = id ? Inventory.useUpdate(id) : undefined;
  const create = Inventory.useCreate();

  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [price, setPrice] = React.useState("");

  React.useEffect(() => {
    setSku((data as any)?.sku ?? "");
    setName((data as any)?.name ?? "");
    setPrice((data as any)?.price != null ? String((data as any)?.price) : "");
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload: any = { sku, name, kind: "good", price: price ? Number(price) : undefined };
      if (id && update) {
        await update.mutateAsync(payload);
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        navigation.navigate("InventoryList");
      }
    } catch (e: any) {
      console.warn("Save failed:", e?.message || e);
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  if (id && isLoading) return <View style={{ padding: 16 }}><Text style={{ color: t.colors.muted }}>Loading…</Text></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 16 }}>
      <LabeledInput label="SKU" value={sku} onChangeText={setSku} />
      <LabeledInput label="Name" value={name} onChangeText={setName} />
      <LabeledInput label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
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
