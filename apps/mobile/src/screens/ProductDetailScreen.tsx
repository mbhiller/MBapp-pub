import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Products } from "../features/products/hooks";
import { useColors } from "../providers/useColors";

function iso(d?: string) { return d ? new Date(d).toLocaleString() : "—"; }

export default function ProductDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const isCreate = !id;

  const t = useColors();
  const get = Products.useGet(id);
  const create = Products.useCreate();
  const update = id ? Products.useUpdate(id) : undefined;

  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<"good" | "service">("good");
  const [price, setPrice] = React.useState<string>("");
  const [uom, setUom] = React.useState("");
  const [taxCode, setTaxCode] = React.useState("");

  React.useEffect(() => {
    if (isCreate) {
      setSku(""); setName(""); setKind("good"); setPrice(""); setUom(""); setTaxCode("");
      return;
    }
    if (get.data) {
      setSku(get.data.sku ?? "");
      setName(get.data.name ?? "");
      setKind((get.data.kind as any) ?? "good");
      setPrice(typeof get.data.price === "number" ? String(get.data.price) : "");
      setUom(get.data.uom ?? "");
      setTaxCode(get.data.taxCode ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get.data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    const trimmedName = name.trim();
    const trimmedSku = sku.trim();
    const priceNum = price.trim() === "" ? undefined : Number(price);
    if (!trimmedName && !trimmedSku) {
      Alert.alert("Validation", "Either Name or SKU is required.");
      return;
    }
    try {
      const payload = {
        sku: trimmedSku || undefined,
        name: trimmedName || undefined,
        kind,
        price: typeof priceNum === "number" && !isNaN(priceNum) ? priceNum : undefined,
        uom: uom.trim() || undefined,
        taxCode: taxCode.trim() || undefined,
      };
      if (id && update) {
        await update.mutateAsync(payload);
        Alert.alert("Saved", "Product updated.");
        navigation.goBack();
      } else {
        await create.mutateAsync(payload);
        Alert.alert("Saved", "Product created.");
        navigation.navigate("ProductsList");
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.colors.text,
    backgroundColor: t.colors.background,
  } as const;

  const KindPill = ({ value }: { value: "good" | "service" }) => (
    <Pressable
      onPress={() => setKind(value)}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: kind === value ? t.colors.primary : t.colors.border,
        backgroundColor: kind === value ? t.colors.primary : t.colors.card,
        marginRight: 8,
      }}
    >
      <Text style={{ color: kind === value ? t.colors.buttonText : t.colors.text, fontWeight: "700" }}>{value}</Text>
    </Pressable>
  );

  if (id && get.isLoading) {
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.colors.background }}>
        <Text style={{ color: t.colors.muted }}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Card>
        <SectionTitle title={isCreate ? "New Product" : "Edit Product"} />

        <Labeled label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Product name"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
          />
        </Labeled>

        <Labeled label="SKU">
          <TextInput
            value={sku}
            onChangeText={setSku}
            placeholder="ABC-123"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            autoCapitalize="characters"
          />
        </Labeled>

        <Labeled label="Kind">
          <View style={{ flexDirection: "row" }}>
            <KindPill value="good" />
            <KindPill value="service" />
          </View>
        </Labeled>

        <Labeled label="Price">
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            keyboardType="decimal-pad"
          />
        </Labeled>

        <Labeled label="UOM">
          <TextInput
            value={uom}
            onChangeText={setUom}
            placeholder="ea, hr, box"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            autoCapitalize="none"
          />
        </Labeled>

        <Labeled label="Tax Code">
          <TextInput
            value={taxCode}
            onChangeText={setTaxCode}
            placeholder="TAX-001"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            autoCapitalize="characters"
          />
        </Labeled>

        {!isCreate && (
          <View style={{ marginTop: 6 }}>
            <Text style={{ color: t.colors.muted, fontSize: 12 }}>
              Created: {iso(get.data?.createdAt)} • Updated: {iso(get.data?.updatedAt)}
            </Text>
          </View>
        )}

        <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
      </Card>
    </ScrollView>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const t = useColors();
  return (
    <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16, gap: 12 }}>
      {children}
    </View>
  );
}
function SectionTitle({ title }: { title: string }) {
  const t = useColors();
  return <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>{title}</Text>;
}
function Labeled({ label, children }: React.PropsWithChildren<{ label: string }>) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 10 }}>
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
