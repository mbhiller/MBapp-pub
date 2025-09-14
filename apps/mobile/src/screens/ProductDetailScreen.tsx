import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { getProduct, createProduct, updateProduct, type Product } from "../features/products/api";

type Props = any; // keep this simple; if you have RootStackScreenProps<"ProductDetail">, you can use it instead

export default function ProductDetailScreen({ route, navigation }: Props) {
  const id: string | undefined = route?.params?.id;
  const modeParam: "view" | "edit" | "create" | undefined = route?.params?.mode;
  const isCreate = modeParam === "create" || !id;

  // form state
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState<string>(""); // keep as string for input
  const [uom, setUom] = useState("each");
  const [taxCode, setTaxCode] = useState("");
  const [kind, setKind] = useState<"good" | "service">("good");

  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // load existing when editing
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
        const created = await createProduct(body);
        // Go back to list with the created product for instant display
        navigation.navigate("ProductsList", { created });
      } else if (id) {
        const updated = await updateProduct(id, body);
        // After edit, just go back; list will refetch on focus
        navigation.goBack();
        // If you want to pass updated back too:
        // navigation.navigate("ProductsList", { updated });
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        {err ? <Text style={{ marginTop: 8, color: "crimson" }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {err ? <Text style={{ color: "crimson" }}>{err}</Text> : null}

        <Field label="Name" required>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g., Deluxe Wash"
            style={styles.input}
          />
        </Field>

        <Field label="SKU">
          <TextInput
            value={sku}
            onChangeText={setSku}
            placeholder="e.g., SKU-00123"
            autoCapitalize="characters"
            style={styles.input}
          />
        </Field>

        <Field label="Price">
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="e.g., 9.99"
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </Field>

        <Field label="UOM">
          <TextInput
            value={uom}
            onChangeText={setUom}
            placeholder="e.g., each"
            autoCapitalize="none"
            style={styles.input}
          />
        </Field>

        <Field label="Tax Code">
          <TextInput
            value={taxCode}
            onChangeText={setTaxCode}
            placeholder="optional"
            autoCapitalize="characters"
            style={styles.input}
          />
        </Field>

        <Text style={{ fontWeight: "600", marginTop: 8 }}>Kind</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Segment onPress={() => setKind("good")} selected={kind === "good"}>Good</Segment>
          <Segment onPress={() => setKind("service")} selected={kind === "service"}>Service</Segment>
        </View>

        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          style={[styles.button, saving && { opacity: 0.6 }]}
        >
          <Text style={styles.buttonText}>{isCreate ? "Create" : "Save"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          disabled={saving}
          style={[styles.buttonSecondary]}
        >
          <Text style={styles.buttonSecondaryText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{ fontWeight: "600", marginBottom: 6 }}>
        {label} {required ? <Text style={{ color: "crimson" }}>*</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Segment({ children, selected, onPress }: { children: React.ReactNode; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: selected ? "#333" : "#ddd",
      }}
    >
      <Text style={{ color: selected ? "#fff" : "#333", fontWeight: "600" }}>{children}</Text>
    </TouchableOpacity>
  );
}

const styles = {
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#007aff",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  buttonSecondary: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#eee",
  },
  buttonSecondaryText: { color: "#333", fontWeight: "600" },
} as const;
