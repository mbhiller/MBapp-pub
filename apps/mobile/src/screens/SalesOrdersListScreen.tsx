import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { useTheme } from "../providers/ThemeProvider";
import { apiClient } from "../api/client";
import { useToast } from "../features/_shared/Toast";
import { createParty, addPartyRole } from "../features/parties/api";
import { upsertInventoryItem } from "../features/inventory/api";
import { useViewsApi } from "../features/views/hooks";
import { mapViewToMobileState, type SavedView } from "../features/views/applyView";
import type { RootStackParamList } from "../navigation/types";

export default function SalesOrdersListScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "SalesOrdersList">>();
  const t = useTheme();
  const toast = useToast();
  const listRef = React.useRef<FlatList<any>>(null);
  const scrollToTopOnNextFocus = React.useRef(false);
  const { get: getView } = useViewsApi();
  const defaultSort = React.useMemo(() => ({ by: "updatedAt", dir: "desc" as const }), []);
  const [q, setQ] = React.useState("");
  const [appliedView, setAppliedView] = React.useState<SavedView | null>(null);
  const [filters, setFilters] = React.useState<{ filter?: Record<string, any>; sort?: { by?: string; dir?: "asc" | "desc" } }>({
    filter: undefined,
    sort: defaultSort,
  });
  const filterJSON = React.useMemo(() => JSON.stringify(filters.filter ?? {}), [filters.filter]);
  const sortJSON = React.useMemo(() => JSON.stringify(filters.sort ?? defaultSort), [filters.sort, defaultSort]);

  const { data, isLoading, refetch, reset } = useObjects<any>({
    type: "salesOrder",
    q,
    filter: filters.filter,
    query: { sort: filters.sort?.dir ?? "desc", by: filters.sort?.by ?? "updatedAt" },
    params: { limit: __DEV__ ? 200 : 50 },
  });

  const rawItems = data?.items ?? [];
  const items = React.useMemo(() => {
    return [...rawItems].sort((a, b) => {
      const aCreated = (a as any)?.createdAt ? new Date((a as any).createdAt).getTime() : 0;
      const bCreated = (b as any)?.createdAt ? new Date((b as any).createdAt).getTime() : 0;
      if (aCreated !== bCreated) return bCreated - aCreated;
      const aUpdated = (a as any)?.updatedAt ? new Date((a as any).updatedAt).getTime() : 0;
      const bUpdated = (b as any)?.updatedAt ? new Date((b as any).updatedAt).getTime() : 0;
      if (aUpdated !== bUpdated) return bUpdated - aUpdated;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  }, [rawItems]);

  React.useEffect(() => { refetch(); }, [q, filterJSON, sortJSON, refetch]);
  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(async () => {
        await refetch();
        if (scrollToTopOnNextFocus.current) {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
          scrollToTopOnNextFocus.current = false;
        }
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
        const result = mapViewToMobileState("salesOrder", view);
        setAppliedView(view);
        if (result.applied.q !== undefined) setQ(result.applied.q ?? "");
        setFilters({
          filter: result.applied.filter,
          sort: result.applied.sort ?? defaultSort,
        });
        reset?.();
      } catch (e) {
        if (__DEV__) console.warn("Failed to apply view", e);
      }
    })();
  }, [route.params?.viewId, getView, defaultSort, reset]);

  const clearView = () => {
    setAppliedView(null);
    setFilters({ filter: undefined, sort: defaultSort });
    setQ("");
    reset?.();
  };

  const ensurePartyId = async (): Promise<string> => {
    try {
      const res = await apiClient.get<any>("/objects/party?limit=1&query.sort=desc&query.by=updatedAt");
      const parties = (res as any)?.items ?? (res as any)?.body?.items ?? [];
      if (parties.length > 0) return parties[0].id;
    } catch {}
    const p = await createParty({ kind: "person", name: "Seed Party - UI" });
    try { await addPartyRole(p.id, "customer"); } catch {}
    return p.id;
  };

  const ensureInventoryId = async (): Promise<string> => {
    try {
      const res = await apiClient.get<any>("/objects/inventory?limit=1&query.sort=desc&query.by=updatedAt");
      const items = (res as any)?.items ?? (res as any)?.body?.items ?? [];
      if (items.length > 0) return items[0].id;
    } catch {}
    const shortId = Math.random().toString(36).slice(2, 8);
    const inv = await upsertInventoryItem({
      type: "inventory" as any,
      name: `Seed Inventory - UI ${shortId}`,
      sku: `SKU-${shortId}`,
    });
    return (inv as any)?.id;
  };

  const createDraft = async () => {
    try {
      const partyId = await ensurePartyId();
      const itemId = await ensureInventoryId();
      const shortId = Math.random().toString(36).slice(2, 8);
      const so = await apiClient.post<any>("/objects/salesOrder", {
        type: "salesOrder" as any,
        status: "draft" as any,
        partyId,
        lines: [{ id: `L${shortId}`, itemId, qty: 1, uom: "ea" }],
      });
      const soId = (so as any)?.id ?? (so as any)?.body?.id;
      if (!soId) throw new Error("Sales order create failed");
      toast(`✓ Created SO: ${soId}`, "success");
      scrollToTopOnNextFocus.current = true;
      nav.navigate("SalesOrderDetail", { id: soId });
    } catch (e: any) {
      toast(`✗ Create failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const isNew = (iso?: string) => {
    if (!iso) return false;
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < 10 * 60 * 1000;
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {appliedView && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card, marginBottom: 8 }}>
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>
            Active View: {appliedView.name || appliedView.id}
          </Text>
          <Pressable onPress={clearView}>
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Clear</Text>
          </Pressable>
        </View>
      )}
      <TextInput
        placeholder="Search sales orders"
        placeholderTextColor={t.colors.textMuted}
        value={q}
        onChangeText={setQ}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, marginBottom: 12, backgroundColor: t.colors.card, color: t.colors.text }}
      />
      <Pressable
        onPress={createDraft}
        style={{
          backgroundColor: t.colors.primary,
          padding: 12,
          borderRadius: 8,
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>+ New Sales Order</Text>
      </Pressable>
      {isLoading && !data ? <ActivityIndicator /> : (
        <FlatList
          ref={listRef}
          data={items}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => nav.navigate("SalesOrderDetail", { id: item.id })}>
              <View style={{ padding: 10, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, marginBottom: 8, backgroundColor: t.colors.card }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ color: t.colors.text, fontWeight: "700" }}>{item.id}</Text>
                  {isNew((item as any).createdAt) && (
                    <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: t.colors.primary }}>
                      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Status: {item.status}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
