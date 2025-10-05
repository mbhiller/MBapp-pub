// apps/mobile/src/screens/InventoryDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import { createObject, updateObject, getObject } from "../api/client";
import StockCard from "../features/inventory/StockCard";
import type { components } from "../api/generated-types";
type InventoryItem = components["schemas"]["InventoryItem"];

const STATUS_VALUES = ["active", "inactive", "archived"] as const;
type Status = typeof STATUS_VALUES[number];

export default function InventoryDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const mode: "new" | "edit" | undefined = route?.params?.mode;
  const isNew = mode === "new" || !id;

  // local fields (string-coerced)
  const [name, setName]         = React.useState("");
  const [productId, setProductId]= React.useState("");
  const [sku, setSku]           = React.useState("");
  const [uom, setUom]           = React.useState("");
  const [location, setLocation] = React.useState("");
  const [minQty, setMinQty]     = React.useState("");
  const [maxQty, setMaxQty]     = React.useState("");
  const [status, setStatus]     = React.useState<string>("active");
  const [notes, setNotes]       = React.useState("");

  const [saving, setSaving]     = React.useState(false);
  const [item, setItem]         = React.useState<InventoryItem | null>(null);
  const statusTouched = React.useRef(false);

  const load = React.useCallback(async () => {
    if (isNew || !id) return;
    const obj = await getObject<InventoryItem>("inventory", String(id));
    setItem(obj);
  }, [isNew, id]);

  useFocusEffect(React.useCallback(() => {
    statusTouched.current = false;
    load().catch(()=>{});
  }, [load]));

  // hydrate-from-server into empty fields only
  React.useEffect(() => {
    if (!item) return;
    setName((v) => v || String((item as any)?.name ?? ""));
    setProductId((v) => v || String((item as any)?.productId ?? ""));
    setSku((v) => v || String((item as any)?.sku ?? ""));
    setUom((v) => v || String((item as any)?.uom ?? ""));
    setLocation((v) => v || String((item as any)?.location ?? ""));
    setMinQty((v) => v || ((item as any)?.minQty != null ? String((item as any).minQty) : ""));
    setMaxQty((v) => v || ((item as any)?.maxQty != null ? String((item as any).maxQty) : ""));
    if (!statusTouched.current) setStatus(String((item as any)?.status ?? "active"));
    setNotes((v) => v || String((item as any)?.notes ?? ""));
  }, [item]);

  async function onSave() {
    if (!name.trim()) { Alert.alert("Name is required"); return; }
    setSaving(true);
    try {
      const normalized = (status ?? "").trim().toLowerCase();
      const statusEnum: Status = (STATUS_VALUES as readonly string[]).includes(normalized as Status)
        ? (normalized as Status) : "active";

      const payload: Partial<InventoryItem> = {
        ...(isNew ? {} : { id }),
        type: "inventory",
        name: name.trim(),
        productId: productId.trim() || undefined,
        sku: sku.trim() || undefined,
        uom: uom.trim() || undefined,
        location: location.trim() || undefined,
        minQty: minQty.trim() === "" ? undefined : Number(minQty),
        maxQty: maxQty.trim() === "" ? undefined : Number(maxQty),
        status: statusEnum as any,
        notes: notes.trim() || undefined,
      };

      if (isNew) await createObject<InventoryItem>("inventory", payload as any);
      else       await updateObject<InventoryItem>("inventory", String(id), payload as any);

      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16, marginBottom: 12 }}>
        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="Product ID" value={productId} onChangeText={setProductId} />
        <Field label="SKU" value={sku} onChangeText={setSku} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Field label="UOM" value={uom} onChangeText={setUom} /></View>
          <View style={{ flex: 1 }}><Field label="Location" value={location} onChangeText={setLocation} /></View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Field label="Min Qty" value={minQty} onChangeText={setMinQty} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Field label="Max Qty" value={maxQty} onChangeText={setMaxQty} keyboardType="numeric" /></View>
        </View>

        <Label text="Status" />
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable onPress={onSave} style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </Text>
        </Pressable>
      </View>

      {/* Only show stock info for existing items */}
      {!isNew && id ? <StockCard itemId={id} /> : null}
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
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: multiline ? 80 : undefined }}
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
          <Pressable key={opt} onPress={() => onChange(opt)} style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.primary : t.colors.card, marginRight: 8, marginBottom: 8,
          }}>
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
