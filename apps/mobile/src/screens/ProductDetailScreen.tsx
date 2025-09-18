import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Products } from "../features/products/hooks";
import { useColors } from "../providers/useColors";

export default function ProductDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const t = useColors();
  const { data, isLoading } = Products.useGet(id);
  const update = id ? Products.useUpdate(id) : undefined;
  const create = Products.useCreate();

  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [price, setPrice] = React.useState("");

  React.useEffect(() => {
    setSku((data as any)?.sku ?? "");
    setName((data as any)?.name ?? "");
    setKind((data as any)?.kind ?? "");
    setPrice((data as any)?.price != null ? String((data as any)?.price) : "");
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload: any = { sku, name, kind: kind || undefined, price: price ? Number(price) : undefined };
      if (id && update) {
        await update.mutateAsync(payload);
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        navigation.navigate("ProductsList");
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
      <LabeledInput label="Kind" value={kind} onChangeText={setKind} />
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
