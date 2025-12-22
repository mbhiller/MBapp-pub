// apps/mobile/src/screens/ProductDetailScreen.tsx
import * as React from "react";
import { ScrollView, View, Text, ActivityIndicator, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { getProduct } from "../features/products/api";
import type { Product } from "../features/products/types";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RoutePropType = RouteProp<RootStackParamList, "ProductDetail">;

export default function ProductDetailScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const productId = route.params?.id;

  const [product, setProduct] = React.useState<Product | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [lastError, setLastError] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadProduct();
  }, [productId]);

  const loadProduct = async () => {
    if (!productId) {
      setLastError("No product ID provided");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLastError(null);
    try {
      const p = await getProduct(productId);
      setProduct(p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      setProduct(null);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
      <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 14, color: t.colors.text, fontWeight: "500" }}>
        {value || "—"}
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  if (lastError || !product) {
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
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 8 }}>
            Error loading product
          </Text>
          <Text style={{ color: "#8a1f2d", fontSize: 12, marginBottom: 8 }}>
            {lastError || "Product not found"}
          </Text>
          <Pressable onPress={loadProduct}>
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ padding: 12 }}>
      {/* Product Title */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: t.colors.text, marginBottom: 4 }}>
          {(product as any).name || "(no name)"}
        </Text>
        <Text style={{ fontSize: 12, color: t.colors.textMuted }}>
          ID: {product.id}
        </Text>
      </View>

      {/* Product Details */}
      <View
        style={{
          backgroundColor: t.colors.card,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          padding: 12,
        }}
      >
        <Row label="SKU" value={(product as any).sku} />
        <Row label="Kind" value={(product as any).kind} />
        <Row
          label="Price"
          value={
            (product as any).price != null
              ? `${(product as any).price}`
              : undefined
          }
        />
        <Row
          label="Reorder Enabled"
          value={
            (product as any).reorderEnabled != null
              ? String((product as any).reorderEnabled)
              : undefined
          }
        />
        <Row label="Created" value={formatDateTime((product as any).createdAt)} />
        <Row label="Updated" value={formatDateTime((product as any).updatedAt)} />
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
