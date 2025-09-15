import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { getProduct, createProduct, updateProduct, type Product } from "../features/products/api";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackScreenProps } from "../navigation/types";
import type { ViewStyle, TextStyle } from "react-native";

type Props = RootStackScreenProps<"ProductDetail">;

export default function ProductDetailScreen({ route, navigation }: Props) {
  const t = useTheme();
  const id: string | undefined = route?.params?.id;
  const modeParam: "new" | undefined = route?.params?.mode;
  const isCreate = modeParam === "new" || !id;

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState<string>("");
  const [uom, setUom] = useState("each");
  const [taxCode, setTaxCode] = useState("");
  const [kind, setKind] = useState<"good" | "service">("good");

  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isCreate && id) {
        setLoading(true);
        setErr(null);
        try {
          const p = await getProduct(id);
          if (!mounted) return;
          setName(p.name ?? "");
          setSku(p.sku ?? "");
          setPrice(p.price != null ? String(p.price) : "");
          setUom(p.uom ?? "each");
          setTaxCode(p.taxCode ?? "");
          setKind((p.kind as "good" | "service") ?? "good");
        } catch (e: any) {
          if (mounted) setErr(e?.message || "Failed to load product");
        } finally {
          if (mounted) setLoading(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [id, isCreate]);

  // replace your current onSave with this version
async function onSave() {
  try {
    if (!name.trim()) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    setSaving(true);
    setErr(null);

    const body: Partial<Product> = {
      name: name.trim(),
      sku: sku.trim() || undefined,
      price: price ? Number(price) : undefined,
      uom: uom.trim() || undefined,
      taxCode: taxCode.trim() || undefined,
      kind,
    };

    if (isCreate) {
      await createProduct(body);
      Alert.alert("Saved", "Product created", [
        { text: "OK", onPress: () => navigation.navigate("ProductsList" as never) },
      ]);
    } else if (id) {
      await updateProduct(id, body);
      Alert.alert("Saved", "Product updated", [
        { text: "OK", onPress: () => navigation.navigate("ProductsList" as never) },
      ]);
    }
  } catch (e: any) {
    setErr(e?.message || "Save failed");
    Alert.alert("Save failed", e?.message || "Unknown error");
  } finally {
    setSaving(false);
  }
}


  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator />
        {err ? <Text style={{ marginTop: 8, color: t.colors.danger }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        {err ? <Text style={{ color: t.colors.danger, marginBottom: 10 }}>{err}</Text> : null}

        <Field label="Name" required>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g., Deluxe Wash"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
          />
        </Field>

        <Field label="SKU">
          <TextInput
            value={sku}
            onChangeText={setSku}
            placeholder="e.g., SKU-00123"
            autoCapitalize="characters"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
          />
        </Field>

        <Field label="Price">
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="e.g., 9.99"
            keyboardType="decimal-pad"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
          />
        </Field>

        <Field label="UOM">
          <TextInput
            value={uom}
            onChangeText={setUom}
            placeholder="e.g., each"
            autoCapitalize="none"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
          />
        </Field>

        <Field label="Tax Code">
          <TextInput
            value={taxCode}
            onChangeText={setTaxCode}
            placeholder="optional"
            autoCapitalize="characters"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
          />
        </Field>

        <Text style={{ fontWeight: "600" as TextStyle["fontWeight"], marginTop: 8, color: t.colors.text }}>
          Kind
        </Text>
        <View style={{ flexDirection: "row", marginTop: 6 }}>
          <Segment onPress={() => setKind("good")}    selected={kind === "good"}    label="Good" />
          <View style={{ width: 8 }} />
          <Segment onPress={() => setKind("service")} selected={kind === "service"} label="Service" />
        </View>

        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          style={[styles.primaryBtn(t), saving && ({ opacity: 0.6 } as ViewStyle)]}
        >
          <Text style={styles.primaryBtnText(t)}>{isCreate ? "Create" : "Save"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          disabled={saving}
          style={styles.secondaryBtn(t)}
        >
          <Text style={styles.secondaryBtnText(t)}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontWeight: "600" as TextStyle["fontWeight"], marginBottom: 6 }}>
        {label} {required ? <Text style={{ color: "crimson" }}>*</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Segment({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: selected ? "#333" : t.colors.card,
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      <Text style={{ color: selected ? "#fff" : "#333", fontWeight: "600" as TextStyle["fontWeight"] }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = {
  input: (t: ReturnType<typeof useTheme>): TextStyle => ({
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: t.colors.card,
    color: t.colors.text, // TextStyle OK
  }),
  primaryBtn: (t: ReturnType<typeof useTheme>): ViewStyle => ({
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: t.colors.primary,
  }),
  primaryBtnText: (t: ReturnType<typeof useTheme>): TextStyle => ({
    color: t.colors.headerText,
    fontWeight: "700",
  }),
  secondaryBtn: (t: ReturnType<typeof useTheme>): ViewStyle => ({
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: t.colors.card,
    borderWidth: 1,
    borderColor: t.colors.border,
  }),
  secondaryBtnText: (t: ReturnType<typeof useTheme>): TextStyle => ({
    color: t.colors.text,
    fontWeight: "600",
  }),
} as const;
