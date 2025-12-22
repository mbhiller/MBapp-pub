// apps/mobile/src/screens/ResourcesListScreen.tsx
import * as React from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listResources, createResource } from "../features/resources/api";
import type { Resource } from "../features/resources/types";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";

const PAGE_SIZE = 20;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ResourcesListScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [items, setItems] = React.useState<Resource[]>([]);
  const [next, setNext] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [seedStatus, setSeedStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setIsLoading(true);
    setLastError(null);
    try {
      const page = await listResources({ limit: PAGE_SIZE });
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
      const page = await listResources({ limit: PAGE_SIZE, next });
      setItems((prev) => [...prev, ...(page.items || [])]);
      setNext(page.next || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  const seedResource = async () => {
    setSeedStatus(null);
    try {
      const name = `Resource ${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await createResource({
        // minimal payload aligned with smokes
        type: "resource" as any,
        name: name as any,
        status: "available" as any,
      });
      setSeedStatus("✓ Resource created");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSeedStatus(`✗ Failed: ${msg}`);
    }
  };

  const renderItem = ({ item }: { item: Resource }) => {
    const title = (item as any).name || item.id || "(no name)";
    const type = (item as any).type || "resource";
    const updated = formatDateTime((item as any).updatedAt);
    const createdRaw = (item as any).createdAt as string | undefined;
    const created = formatDateTime(createdRaw);
    const isNew = (() => {
      if (!createdRaw) return false;
      const ts = new Date(createdRaw).getTime();
      if (isNaN(ts)) return false;
      return Date.now() - ts < 10 * 60 * 1000; // 10 minutes
    })();

    return (
      <Pressable
        onPress={() => navigation.navigate("ResourceDetail", { id: item.id })}
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          marginBottom: 8,
          backgroundColor: t.colors.card,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <Text style={{ color: t.colors.text, fontWeight: "700" }}>{title}</Text>
          {isNew && (
            <View
              style={{
                marginLeft: 8,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 10,
                backgroundColor: t.colors.primary,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
            </View>
          )}
        </View>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 2 }}>Type: {type}</Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Updated: {updated || "—"}</Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Created: {created || "—"}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {__DEV__ && (
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
              onPress={seedResource}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                backgroundColor: t.colors.primary,
                borderRadius: 6,
                marginRight: 8,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Seed Resource</Text>
            </Pressable>
            {seedStatus && (
              <Text style={{ color: t.colors.textMuted }}>{seedStatus}</Text>
            )}
          </View>
        </View>
      )}
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
            Error loading resources
          </Text>
          <Text style={{ color: "#8a1f2d", fontSize: 12 }}>{lastError}</Text>
          <Pressable onPress={load} style={{ marginTop: 8 }}>
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {isLoading && items.length === 0 ? (
        <ActivityIndicator size="large" color={t.colors.primary} />
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: t.colors.textMuted }}>No resources found</Text>
        </View>
      ) : (
        <FlatList
          data={items}
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
