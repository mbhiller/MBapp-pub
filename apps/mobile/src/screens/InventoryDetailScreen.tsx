import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Inventory } from "../features/inventory/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { InventoryItem } from "../features/inventory/types";

const STATUS_VALUES = ["active", "inactive", "archived"] as const;
type Status = typeof STATUS_VALUES[number];

export default function InventoryDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<InventoryItem>;

  const { data, refetch, isFetching } = Inventory.useGet(id);
  const save = Inventory.useSave();

  const [productId, setProductId] = React.useState(String((initial as any)?.productId ?? ""));
  const [name, setName] = React.useState(String(initial?.name ?? ""));
  const [sku, setSku] = React.useState(String((initial as any)?.sku ?? ""));
  const [quantity, setQuantity] = React.useState(String((initial as any)?.quantity ?? ""));
  const [uom, setUom] = React.useState(String((initial as any)?.uom ?? ""));
  const [location, setLocation] = React.useState(String((initial as any)?.location ?? ""));
  const [minQty, setMinQty] = React.useState(String((initial as any)?.minQty ?? ""));
  const [maxQty, setMaxQty] = React.useState(String((initial as any)?.maxQty ?? ""));
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "active"));

  const statusTouched = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      if (id) refetch();
    }, [id, refetch])
  );

  React.useEffect(() => {
    if (!data) return;
    const d = data as InventoryItem;

    if (productId === "") setProductId(String((d as any)?.productId ?? ""));
    if (name === "") setName(String((d as any)?.name ?? ""));
    if (sku === "") setSku(String((d as any)?.sku ?? ""));
    if (quantity === "") setQuantity((d as any)?.quantity != null ? String((d as any).quantity) : "");
    if (uom === "") setUom(String((d as any)?.uom ?? ""));
    if (location === "") setLocation(String((d as any)?.location ?? ""));
    if (minQty === "") setMinQty((d as any)?.minQty != null ? String((d as any).minQty) : "");
    if (maxQty === "") setMaxQty((d as any)?.maxQty != null ? String((d as any).maxQty) : "");
    if (notes === "") setNotes(String((d as any)?.notes ?? ""));
    const serverStatus = String((d as any)?.status ?? "active");
    if (!statusTouched.current) setStatus(serverStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onSave = async () => {
    // Name and/or SKU are both optional; keep validation minimal by design
    const normalized = (status ?? "").trim().toLowerCase();
    const statusEnum: Status = (STATUS_VALUES as readonly string[]).includes(normalized as Status) ? (normalized as Status) : "active";

    const qtyNum = quantity.trim() === "" ? undefined : Number(quantity);
    const minNum = minQty.trim() === "" ? undefined : Number(minQty);
    const maxNum = maxQty.trim() === "" ? undefined : Number(maxQty);

    if ([qtyNum, minNum, maxNum].some((n) => n != null && !Number.isFinite(n as number))) {
      Alert.alert("Invalid numbers", "Quantity, Min, and Max must be numeric.");
      return;
    }

    const payload: Partial<InventoryItem> = {
      id,
      type: "inventory",
      productId: productId.trim() || undefined,  // OPTIONAL link to product
      name: name.trim() || undefined,
      sku: sku.trim() || undefined,
      quantity: qtyNum as any,
      uom: uom.trim() || undefined,
      location: location.trim() || undefined,
      minQty: minNum as any,
      maxQty: maxNum as any,
      notes: notes.trim() || undefined,
      status: statusEnum,
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
        <Field label="Product ID (optional)" value={productId} onChangeText={setProductId} />
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="SKU" value={sku} onChangeText={setSku} />
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
        <Field label="UOM" value={uom} onChangeText={setUom} />
        <Field label="Location" value={location} onChangeText={setLocation} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Min Qty" value={minQty} onChangeText={setMinQty} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Field label="Max Qty" value={maxQty} onChangeText={setMaxQty} keyboardType="numeric" /></View>
        </View>
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Label text="Status" />
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Pressable
          onPress={onSave}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{id ? (isFetching ? "Saving…" : "Save") : "Create"}</Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
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
        style={{
          backgroundColor: t.colors.bg, color: t.colors.text,
          borderColor: t.colors.border, borderWidth: 1, borderRadius: 8,
          padding: 12, minHeight: multiline ? 80 : undefined
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}
function PillGroup({ options, value, onChange }:{ options: string[]; value?: string; onChange: (v: string) => void; }) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
              borderColor: selected ? t.colors.primary : t.colors.border,
              backgroundColor: selected ? t.colors.primary : t.colors.card,
              marginRight: 8, marginBottom: 8
            }}
          >
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
