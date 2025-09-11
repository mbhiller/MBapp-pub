import React, { useState, useEffect } from "react";
import { View, Text, TextInput, Button, Alert } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { getProduct, updateProduct, type Product } from "../features/catalog/api";

type Params = { id?: string; sku?: string; mode?: "new" | "edit" };

export default function ProductDetailScreen({ route, navigation }: RootStackScreenProps<"ProductDetail">) {
  const { id, mode } = (route.params ?? {}) as Params;

  const [form, setForm] = useState<Partial<Product>>({});
  const [loading, setLoading] = useState<boolean>(!!id);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mode === "edit" && id) {
        try {
          const p = await getProduct(id);
          if (mounted) setForm(p);
        } catch (e: any) {
          Alert.alert("Error", e?.message || "Failed to load product");
        } finally {
          if (mounted) setLoading(false);
        }
      } else {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [mode, id]);

  const save = async () => {
    try {
      if (mode === "new") {
        Alert.alert("Not implemented", "Creating products is not implemented on the API yet.");
        return;
      }
      if (!id) return;
      await updateProduct(id, {
        name: form.name,
        sku: form.sku,
        type: form.type,
        uom: form.uom,
        price: form.price,
      });
      Alert.alert("Saved", "Product updated.");
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to save");
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontWeight: "700", fontSize: 16, marginBottom: 12 }}>
        {mode === "new" ? "New Product" : "Edit Product"}
      </Text>

      <Text>Name</Text>
      <TextInput value={form.name ?? ""} onChangeText={(v) => setForm((s) => ({ ...s, name: v }))} style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, marginBottom: 10 }} />

      <Text>SKU</Text>
      <TextInput value={form.sku ?? ""} onChangeText={(v) => setForm((s) => ({ ...s, sku: v }))} style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, marginBottom: 10 }} />

      <Button title="Save" onPress={save} />
    </View>
  );
}
