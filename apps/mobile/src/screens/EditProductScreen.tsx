// apps/mobile/src/screens/EditProductScreen.tsx
import * as React from "react";
import { ScrollView, View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { getProduct, updateProduct } from "../features/products/api";
import type { Product } from "../features/products/types";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";
import { useToast } from "../features/_shared/Toast";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RoutePropType = RouteProp<RootStackParamList, "EditProduct">;

export default function EditProductScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const productId = route.params?.id;
  const toast = useToast();

  const [product, setProduct] = React.useState<Product | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [sku, setSku] = React.useState("");
  const [type, setType] = React.useState("good");
  const [uom, setUom] = React.useState("ea");
  const [price, setPrice] = React.useState("");
  const [preferredVendorId, setPreferredVendorId] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadProduct();
  }, [productId]);

  const loadProduct = async () => {
    if (!productId) {
      setError("No product ID provided");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const p = await getProduct(productId);
      setProduct(p);
      setName((p as any).name || "");
      setSku((p as any).sku || "");
      setType((p as any).type || "good");
      setUom((p as any).uom || "ea");
      setPrice((p as any).price !== undefined ? String((p as any).price) : "");
      setPreferredVendorId((p as any).preferredVendorId || "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      toast(`✗ ${msg}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!productId) return;

    setError(null);
    setIsSubmitting(true);

    try {
      if (!name.trim()) {
        throw new Error("Name is required");
      }
      if (!sku.trim()) {
        throw new Error("SKU is required");
      }

      const payload: any = {
        name: name.trim(),
        sku: sku.trim(),
        type: type || "good",
        uom: uom.trim() || "ea",
      };

      if (price.trim()) {
        const priceNum = parseFloat(price.trim());
        if (!isNaN(priceNum) && priceNum >= 0) {
          payload.price = priceNum;
        }
      }

      if (preferredVendorId.trim()) {
        payload.preferredVendorId = preferredVendorId.trim();
      }

      await updateProduct(productId, payload);
      toast("✓ Product updated", "success");
      navigation.goBack();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      toast(`✗ ${msg}`, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  if (error && !product) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ padding: 12 }}>
        <View
          style={{
            padding: 12,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontSize: 14 }}>{error}</Text>
        </View>
        <Pressable onPress={loadProduct}>
          <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Retry</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ padding: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: t.colors.text, marginBottom: 16 }}>
        Edit Product
      </Text>

      {error && (
        <View
          style={{
            padding: 12,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontSize: 14 }}>{error}</Text>
        </View>
      )}

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, color: t.colors.text, marginBottom: 4 }}>Name *</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Product name"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
            color: t.colors.text,
          }}
        />
      </View>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, color: t.colors.text, marginBottom: 4 }}>SKU *</Text>
        <TextInput
          value={sku}
          onChangeText={setSku}
          placeholder="SKU-001"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
            color: t.colors.text,
          }}
        />
      </View>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, color: t.colors.text, marginBottom: 4 }}>Type</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => setType("good")}
            style={{
              flex: 1,
              padding: 12,
              borderWidth: 1,
              borderColor: type === "good" ? t.colors.primary : t.colors.border,
              borderRadius: 8,
              backgroundColor: type === "good" ? t.colors.primary + "22" : t.colors.card,
            }}
          >
            <Text
              style={{
                textAlign: "center",
                color: type === "good" ? t.colors.primary : t.colors.text,
                fontWeight: type === "good" ? "700" : "400",
              }}
            >
              Good
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setType("service")}
            style={{
              flex: 1,
              padding: 12,
              borderWidth: 1,
              borderColor: type === "service" ? t.colors.primary : t.colors.border,
              borderRadius: 8,
              backgroundColor: type === "service" ? t.colors.primary + "22" : t.colors.card,
            }}
          >
            <Text
              style={{
                textAlign: "center",
                color: type === "service" ? t.colors.primary : t.colors.text,
                fontWeight: type === "service" ? "700" : "400",
              }}
            >
              Service
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, color: t.colors.text, marginBottom: 4 }}>Unit of Measure</Text>
        <TextInput
          value={uom}
          onChangeText={setUom}
          placeholder="ea"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
            color: t.colors.text,
          }}
        />
      </View>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, color: t.colors.text, marginBottom: 4 }}>Price</Text>
        <TextInput
          value={price}
          onChangeText={setPrice}
          placeholder="0.00"
          keyboardType="decimal-pad"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
            color: t.colors.text,
          }}
        />
      </View>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, color: t.colors.text, marginBottom: 4 }}>Preferred Vendor ID</Text>
        <TextInput
          value={preferredVendorId}
          onChangeText={setPreferredVendorId}
          placeholder="Optional"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
            color: t.colors.text,
          }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={handleSubmit}
          disabled={isSubmitting}
          style={{
            flex: 1,
            padding: 16,
            backgroundColor: isSubmitting ? t.colors.border : t.colors.primary,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Update</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => navigation.goBack()}
          disabled={isSubmitting}
          style={{
            flex: 1,
            padding: 16,
            backgroundColor: t.colors.border,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
