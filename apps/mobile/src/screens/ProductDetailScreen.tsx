// apps/mobile/src/screens/ProductDetailScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useCreateProduct, useProduct, useUpdateProduct } from "../features/catalog/useProducts";
import type { Product } from "../api/client";

type Params = { id?: string; mode?: "new" };

export default function ProductDetailScreen() {
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const navigation = useNavigation<any>();
  const { id, mode } = (route.params ?? {}) as Params;

  const creating = mode === "new" || !id;
  const { data, isLoading } = useProduct(creating ? undefined : id);
  const initial: Product | undefined = data;

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"good" | "service">("good");
  const [uom, setUom] = useState("ea");
  const [price, setPrice] = useState<string>("0");
  const [taxCode, setTaxCode] = useState("");

  useEffect(() => {
    if (initial && !creating) {
      setSku(initial.sku ?? "");
      setName(initial.name ?? "");
      setType(initial.type ?? "good");
      setUom(initial.uom ?? "ea");
      setPrice(String(initial.price ?? 0));
      setTaxCode(initial.taxCode ?? "");
    }
  }, [initial, creating]);

  const createMut = useCreateProduct();
  const updateMut = useUpdateProduct(id ?? "");
  const canSave = useMemo(() => (name || "").trim().length > 0, [name]);

  if (!creating && isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  async function onSave() {
    try {
      if (creating) {
        const body = {
          sku: sku.trim(),
          name: name.trim(),
          type,
          uom: uom.trim() || "ea",
          price: Number(price) || 0,
          taxCode: taxCode.trim() || undefined,
        };
        const created = await createMut.mutateAsync(body);
        navigation.replace("ProductDetail", { id: created.id });
      } else {
        const patch: Partial<Product> = {
          sku: sku.trim(),
          name: name.trim(),
          type,
          uom: uom.trim() || "ea",
          price: Number(price) || 0,
          taxCode: taxCode.trim() || undefined,
        };
        await updateMut.mutateAsync(patch);
        Alert.alert("Saved", "Product updated.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save product");
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>{creating ? "New Product" : "Edit Product"}</Text>

      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="SKU" value={sku} onChangeText={setSku} autoCapitalize="characters" />
      <Field
        label="Type (good|service)"
        value={type}
        onChangeText={(v: string) => setType(v === "service" ? "service" : "good")}
      />
      <Field label="UOM" value={uom} onChangeText={setUom} />
      <Field label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <Field label="Tax Code" value={taxCode} onChangeText={setTaxCode} />

      <TouchableOpacity
        disabled={!canSave || createMut.isPending || updateMut.isPending}
        onPress={onSave}
        style={{
          backgroundColor: canSave ? "#007aff" : "#aacbff",
          paddingVertical: 12,
          borderRadius: 10,
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <Text style={{ color: "white", fontWeight: "700" }}>{creating ? "Create" : "Save"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field(props: any) {
  const { label, ...input } = props;
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
