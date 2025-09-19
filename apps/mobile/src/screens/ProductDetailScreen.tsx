import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Products } from "../features/products/hooks";
import { useColors } from "../providers/useColors";

export default function ProductDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const isCreate = !id;

  const t = useColors();
  const { data, isLoading } = Products.useGet(id);
  const update = id ? Products.useUpdate(id) : undefined;
  const create = Products.useCreate();

  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState(""); // will default to "good" for new below
  const [price, setPrice] = React.useState("");

  React.useEffect(() => {
    if (isCreate && !data) {
      setSku("");
      setName("");
      setKind("good");         // <<< default for new items
      setPrice("");
      return;
    }
    if (data) {
      setSku(data?.sku ?? "");
      setName(data?.name ?? "");
      setKind((data?.kind as string) || "");
      setPrice(data?.price != null ? String(data.price) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    try {
      const payload: any = {
        sku: sku?.trim() || undefined,
        name: name?.trim() || undefined,
        kind: (kind?.trim() || "good"),                   // ensure a value
        price: price ? Number(price) : undefined,
      };
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

  if (id && isLoading) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: t.colors.muted }}>Loading…</Text>
      </View>
    );
  }

  const textBox = {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    padding: 10,
    color: t.colors.text,
    backgroundColor: t.colors.card,
  } as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 16 }}>
      <Labeled label="SKU">
        <TextInput value={sku} onChangeText={setSku} style={textBox} />
      </Labeled>
      <Labeled label="Name">
        <TextInput value={name} onChangeText={setName} style={textBox} />
      </Labeled>
      <Labeled label='Kind ("good" or "service")'>
        <TextInput value={kind} onChangeText={setKind} autoCapitalize="none" style={textBox} />
      </Labeled>
      <Labeled label="Price">
        <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={textBox} />
      </Labeled>
      <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
    </ScrollView>
  );
}

function Labeled({ label, children }: React.PropsWithChildren<{ label: string }>) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}
function PrimaryButton({ title, onPress, disabled }: any) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: disabled ? t.colors.disabled : t.colors.primary,
        padding: 14,
        borderRadius: 10,
        alignItems: "center",
        marginTop: 4,
      }}
    >
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}
