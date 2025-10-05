import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Products } from "../features/products/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { Product } from "../features/products/types";

const STATUS_VALUES = ["active", "inactive", "archived"] as const;
const KIND_VALUES = ["good", "service"] as const;
type Status = typeof STATUS_VALUES[number];
type Kind = typeof KIND_VALUES[number];

export default function ProductDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const mode: "new" | "edit" | undefined = route?.params?.mode;
  const isNew = mode === "new" || !id;

  const initial = (route?.params?.initial ?? {}) as Partial<Product> & { notes?: string; taxCode?: string };

  const detail = Products.useGet(isNew ? undefined : id);
  const create = Products.useCreate();
  const update = Products.useUpdate(id ?? "");
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState(String(initial?.name ?? ""));
  const [sku, setSku] = React.useState(String((initial as any)?.sku ?? ""));
  const [price, setPrice] = React.useState(String((initial as any)?.price ?? ""));
  const [taxCode, setTaxCode] = React.useState(String((initial as any)?.taxCode ?? ""));
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "active"));
  const [kind, setKind] = React.useState<string>(String((initial as any)?.kind ?? "good"));

  const statusTouched = React.useRef(false);
  const kindTouched = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      kindTouched.current = false;
      if (!isNew && id) detail.refetch();
    }, [isNew, id, detail.refetch])
  );

  React.useEffect(() => {
    const data = detail.data;
    if (!data) return;

    if (name === "") setName(String(data?.name ?? ""));
    if (sku === "") setSku(String((data as any)?.sku ?? ""));
    if (price === "") setPrice((data as any)?.price != null ? String((data as any).price) : "");
    if (taxCode === "") setTaxCode(String((data as any)?.taxCode ?? ""));
    if (notes === "") setNotes(String((data as any)?.notes ?? ""));

    const serverStatus = String((data as any)?.status ?? "active");
    if (!statusTouched.current) setStatus(serverStatus);

    const serverKind = String((data as any)?.kind ?? "good");
    if (!kindTouched.current) setKind(serverKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  const onSave = async () => {
    if (!name.trim()) { Alert.alert("Name is required"); return; }
    setSaving(true);

    const normalizedStatus = (status ?? "").trim().toLowerCase();
    const statusEnum: Status = (STATUS_VALUES as readonly string[]).includes(normalizedStatus as Status)
      ? (normalizedStatus as Status) : "active";

    const normalizedKind = (kind ?? "").trim().toLowerCase();
    const kindEnum: Kind = (KIND_VALUES as readonly string[]).includes(normalizedKind as Kind)
      ? (normalizedKind as Kind) : "good";

    const priceNum = price.trim() === "" ? undefined : Number(price);
    const payload: Partial<Product> & { notes?: string; taxCode?: string } = {
      ...(isNew ? {} : { id }),
      type: "product",
      name: name.trim(),
      sku: sku.trim() || undefined,
      price: Number.isFinite(priceNum as number) ? (priceNum as number) : undefined,
      taxCode: taxCode.trim() || undefined,
      notes: notes.trim() || undefined,
      status: statusEnum,
      kind: kindEnum,
    };

    try {
      if (isNew) await create.mutateAsync(payload as any);
      else       await update.mutateAsync(payload as any);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormScreen>
      <View style={{
        backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border,
        padding: 16, marginBottom: 12,
      }}>
        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="SKU" value={sku} onChangeText={setSku} />
        <Field label="Price" value={price} onChangeText={setPrice} keyboardType="numeric" />

        <Label text="Kind" />
        <PillGroup
          options={KIND_VALUES as unknown as string[]}
          value={kind}
          onChange={(v) => { kindTouched.current = true; setKind(v); }}
        />

        <Field label="Tax Code" value={taxCode} onChangeText={setTaxCode} />

        <Label text="Status" />
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable
          onPress={onSave}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}

function Field({
  label, value, onChangeText, multiline, keyboardType,
}:{
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
          backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border,
          borderWidth: 1, borderRadius: 8, padding: 12, minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}

function PillGroup({
  options, value, onChange,
}: { options: string[]; value?: string; onChange: (v: string) => void; }) {
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
              marginRight: 8, marginBottom: 8,
            }}
          >
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
