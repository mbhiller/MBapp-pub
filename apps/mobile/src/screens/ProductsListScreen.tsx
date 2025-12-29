// apps/mobile/src/screens/ProductsListScreen.tsx
import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listProducts } from "../features/products/api";
import type { Product } from "../features/products/types";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";
import { useViewsApi } from "../features/views/hooks";
import { mapViewToMobileState, type SavedView } from "../features/views/applyView";

const PAGE_SIZE = __DEV__ ? 200 : 20;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ProductsListScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, "ProductsList">>();
  const { get: getView } = useViewsApi();
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<Product[]>([]);
  const [next, setNext] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [appliedView, setAppliedView] = React.useState<SavedView | null>(null);

  React.useEffect(() => {
    setItems([]);
    setNext(null);
    setLastError(null);
    loadProducts();
  }, [q]);

  const refetch = React.useCallback(() => {
    void loadProducts();
  }, [q]);

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        void refetch();
      });
      return () => task.cancel?.();
    }, [refetch])
  );

  React.useEffect(() => {
    const id = route.params?.viewId;
    if (!id) return;
    (async () => {
      try {
        const view = await getView(id);
        const result = mapViewToMobileState("product", view);
        setAppliedView(view);
        if (result.applied.q !== undefined) setQ(result.applied.q ?? "");
      } catch (e) {
        if (__DEV__) console.warn("Failed to apply view", e);
      }
    })();
  }, [route.params?.viewId, getView]);

  const clearView = () => {
    setAppliedView(null);
    setQ("");
  };

  const loadProducts = async () => {
    setIsLoading(true);
    setLastError(null);
    try {
      const page = await listProducts({ limit: PAGE_SIZE, q: q || undefined });
      setItems(page.items || []);
      setNext(page.next || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      setItems([]);
      setNext(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!next || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await listProducts({ limit: PAGE_SIZE, next, q: q || undefined });
      setItems((prev) => [...prev, ...(page.items || [])]);
      setNext(page.next || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const sortedItems = React.useMemo(() => {
    return [...items].sort((a, b) => {
      const aCreated = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
      const bCreated = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
      if (aCreated !== bCreated) return bCreated - aCreated;
      const aUpdated = (a as any).updatedAt ? new Date((a as any).updatedAt).getTime() : 0;
      const bUpdated = (b as any).updatedAt ? new Date((b as any).updatedAt).getTime() : 0;
      if (aUpdated !== bUpdated) return bUpdated - aUpdated;
      return (b.id || "").localeCompare(a.id || "");
    });
  }, [items]);

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  const renderItem = ({ item }: { item: Product }) => {
    const title = (item as any).name || item.id || "(no name)";
    const sku = (item as any).sku || "";
    const createdRaw = (item as any).createdAt as string | undefined;
    const updatedRaw = (item as any).updatedAt as string | undefined;
    const created = formatDateTime(createdRaw);
    const updated = formatDateTime(updatedRaw);

    const isNew = (() => {
      if (!createdRaw) return false;
      const ts = new Date(createdRaw).getTime();
      if (isNaN(ts)) return false;
      return Date.now() - ts < 10 * 60 * 1000; // 10 minutes
    })();

    return (
      <Pressable
        onPress={() =>
          navigation.navigate("ProductDetail", { id: item.id })
        }
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          marginBottom: 8,
          backgroundColor: t.colors.card,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Text
            style={{
              fontWeight: "600",
              color: t.colors.text,
              flex: 1,
            }}
          >
            {title}
          </Text>
          {isNew && (
            <View
              style={{
                backgroundColor: t.colors.primary,
                borderRadius: 10,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
            </View>
          )}
        </View>
        {sku && (
          <Text style={{ fontSize: 13, color: t.colors.textMuted, marginBottom: 4 }}>
            SKU: {sku}
          </Text>
        )}
        {createdRaw && (
          <Text style={{ fontSize: 11, color: t.colors.textMuted }}>
            Created: {created}
          </Text>
        )}
        {updatedRaw && (
          <Text style={{ fontSize: 11, color: t.colors.textMuted }}>
            Updated: {updated}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {appliedView && (
        <View
          style={{
            padding: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            marginBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>
            Active View: {appliedView.name || appliedView.id}
          </Text>
          <Pressable onPress={clearView}>
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Clear</Text>
          </Pressable>
        </View>
      )}
      {/* Error Banner */}
      {lastError && (
        <View
          style={{
            padding: 8,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 2 }}>
            Error loading products:
          </Text>
          <Text style={{ color: "#8a1f2d", fontSize: 12 }}>
            {lastError}
          </Text>
          <Pressable onPress={loadProducts} style={{ marginTop: 8 }}>
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Create Button */}
      <Pressable
        onPress={() => navigation.navigate("CreateProduct")}
        style={{
          padding: 12,
          backgroundColor: t.colors.primary,
          borderRadius: 8,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Create Product</Text>
      </Pressable>

      {/* Search Input */}
      <TextInput
        placeholder="Search products (name, sku)"
        placeholderTextColor={t.colors.textMuted}
        value={q}
        onChangeText={setQ}
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
          backgroundColor: t.colors.card,
          color: t.colors.text,
        }}
      />

      {/* List */}
      {isLoading && items.length === 0 ? (
        <ActivityIndicator size="large" color={t.colors.primary} />
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: t.colors.textMuted }}>No products found</Text>
        </View>
      ) : (
        <FlatList
          data={sortedItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? (
              <ActivityIndicator size="small" color={t.colors.primary} style={{ marginTop: 8 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}
