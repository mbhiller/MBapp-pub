import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { createProduct, getProduct, updateProduct, type Product } from "../features/products/api";

type Props = RootStackScreenProps<"ProductDetail">;

export default function ProductDetailScreen({ route, navigation }: Props) {
  const { id, mode } = route.params ?? {};
  const creating = mode === "new" || !id;

  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState<string>("");

  // new fields
  const [uom, setUom] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [kind, setKind] = useState<"good" | "service" | "">("");

  async function load() {
    if (!id) return;
    setErr(null);
    setLoading(true);
    try {
      const p = (await getProduct(id)) as Product & {
        uom?: string;
        taxCode?: string;
        kind?: "good" | "service";
      };
      setName(p?.name ?? "");
      setSku(p?.sku ?? "");
      setPrice(p?.price != null ? String(p.price) : "");
      setUom(p?.uom ?? "");
      setTaxCode(p?.taxCode ?? "");
      setKind((p?.kind as any) ?? "");
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!creating) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canSave = useMemo(() => {
    if (name.trim().length === 0) return false;
    if (kind && kind !== "good" && kind !== "service") return false;
    if (price.trim().length === 0) return true;
    const n = Number(price);
    return Number.isFinite(n) && !Number.isNaN(n);
  }, [name, price, kind]);

  async function onSave() {
    try {
      setSaving(true);
      setErr(null);
      const body: Partial<Product> & {
        uom?: string;
        taxCode?: string;
        kind?: "good" | "service";
      } = {
        name: name.trim(),
        sku: sku.trim() || undefined,
        price: price.trim() ? Number(price) : undefined,
        uom: uom.trim() || undefined,
        taxCode: taxCode.trim() || undefined,
        kind: (kind as any) || undefined,
      };

      if (creating) {
        const created = await createProduct(body);
        Alert.alert("Created", "Product created.");
        navigation.replace("ProductDetail", { id: created.id });
      } else {
        await updateProduct(id!, body);
        Alert.alert("Saved", "Product updated.");
        await load();
      }
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        {err ? <Text style={{ marginTop: 8, color: "crimson" }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Field
        label="Name"
        input={{
          value: name,
          onChangeText: (v: string) => setName(v),
          placeholder: "Product name",
        }}
      />
      <Field
        label="SKU"
        input={{
          value: sku,
          onChangeText: (v: string) => setSku(v),
          placeholder: "e.g. ABC-123",
          autoCapitalize: "characters",
        }}
      />
      <Field
        label="Price"
        input={{
          value: price,
          onChangeText: (v: string) => setPrice(v),
          placeholder: "e.g. 19.99",
          keyboardType: "decimal-pad",
        }}
      />

      {/* NEW FIELDS BELOW — they live inside the same ScrollView parent */}
      <Field
        label="UOM"
        input={{
          value: uom,
          onChangeText: (v: string) => setUom(v),
          placeholder: "e.g. each, hr, lb",
        }}
      />
      <Field
        label="Tax Code"
        input={{
          value: taxCode,
          onChangeText: (v: string) => setTaxCode(v),
          placeholder: "e.g. TAXABLE or EXEMPT",
          autoCapitalize: "characters",
        }}
      />
      <Field
        label="Kind (good|service)"
        input={{
          value: kind,
          onChangeText: (v: string) => setKind((v as any)?.toLowerCase()),
          placeholder: "good or service",
          autoCapitalize: "none",
        }}
      />

      <TouchableOpacity
        onPress={onSave}
        disabled={!canSave || saving}
        style={{
          backgroundColor: !canSave || saving ? "#9fbefb" : "#3478f6",
          padding: 14,
          borderRadius: 10,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>
          {saving ? "Saving…" : creating ? "Create" : "Save"}
        </Text>
      </TouchableOpacity>

      {err ? <Text style={{ color: "crimson", marginTop: 8 }}>{err}</Text> : null}
    </ScrollView>
  );
}

function Field({
  label,
  input,
}: {
  label: string;
  input: React.ComponentProps<typeof TextInput>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: "#444" }}>{label}</Text>
      <TextInput
        {...input}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: "white",
        }}
      />
    </View>
  );
}
