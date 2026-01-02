// apps/mobile/src/screens/PurchaseOrdersListScreen.tsx
import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { useTheme } from "../providers/ThemeProvider";
import { apiClient } from "../api/client";
import { useToast } from "../features/_shared/Toast";
import { createParty, addPartyRole } from "../features/parties/api";
import { upsertInventoryItem } from "../features/inventory/api"
import { useViewsApi } from "../features/views/hooks";
import { mapViewToMobileState, type SavedView } from "../features/views/applyView";
import ViewPickerModal from "../features/views/ViewPickerModal";
import SaveViewModal from "../features/views/SaveViewModal";
import type { RootStackParamList } from "../navigation/types";

export default function PurchaseOrdersListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "PurchaseOrdersList">>();
  const t = useTheme();
  const toast = useToast();
  const listRef = React.useRef<any>(null);
  const scrollToTopOnNextFocus = React.useRef(false);
  const { get: getView } = useViewsApi();
  const defaultSort = React.useMemo(() => ({ by: "updatedAt", dir: "desc" as const }), []);
  const [q, setQ] = React.useState("");
  const [appliedView, setAppliedView] = React.useState<SavedView | null>(null);
  const [showViewPicker, setShowViewPicker] = React.useState(false);
  const [saveModalOpen, setSaveModalOpen] = React.useState(false);
  const [filters, setFilters] = React.useState<{ filter?: Record<string, any>; sort?: { by?: string; dir?: "asc" | "desc" } }>({
    filter: undefined,
    sort: defaultSort,
  });
  const filterJSON = React.useMemo(() => JSON.stringify(filters.filter ?? {}), [filters.filter]);
  const sortJSON = React.useMemo(() => JSON.stringify(filters.sort ?? defaultSort), [filters.sort, defaultSort]);

  const { data, isLoading, refetch, reset } = useObjects<any>({
    type: "purchaseOrder",
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

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(async () => {
        await refetch?.();
        if (scrollToTopOnNextFocus.current) {
          listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
          scrollToTopOnNextFocus.current = false;
        }
      });
      return () => task.cancel?.();
    }, [refetch])
  );

  React.useEffect(() => { refetch(); }, [q, filterJSON, sortJSON, refetch]);

  React.useEffect(() => {
    const id = route.params?.viewId;
    if (!id) return;
    (async () => {
      try {
        const view = await getView(id);
        const result = mapViewToMobileState("purchaseOrder", view);
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

  const handleApplyView = (view: SavedView) => {
    const result = mapViewToMobileState("purchaseOrder", view);
    setAppliedView(view);
    if (result.applied.q !== undefined) {
      setQ(result.applied.q ?? "");
    }
    setFilters({
      filter: result.applied.filter,
      sort: result.applied.sort ?? defaultSort,
    });
    reset?.();
    setShowViewPicker(false);
  };

  const handleViewSaved = (view: SavedView) => {
    setAppliedView(view);
  };

  const ensureVendorId = async (): Promise<string> => {
    try {
      const res = await apiClient.get<any>("/objects/party?limit=50&query.sort=desc&query.by=updatedAt");
      const parties = (res as any)?.items ?? (res as any)?.body?.items ?? [];
      const vendor = parties.find((p: any) => p.roles?.includes("vendor"));
      if (vendor) return vendor.id;
      if (parties.length > 0) {
        try {
          await addPartyRole(parties[0].id, "vendor");
          return parties[0].id;
        } catch (err) {
          console.error("Failed to add vendor role to existing party", err);
        }
      }
    } catch (err) {
      console.error(err);
    }
    const shortId = Math.random().toString(36).slice(2, 8);
    const p = await createParty({ kind: "organization", name: `Seed Vendor - UI ${shortId}` });
    try {
      await addPartyRole(p.id, "vendor");
    } catch (err) {
      console.error("Failed to add vendor role to new party", err);
      throw new Error("Failed to assign vendor role to new party");
    }
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
      const vendorId = await ensureVendorId();
      if (!vendorId) { toast("No vendor available (seed failed).", "error"); return; }
      const itemId = await ensureInventoryId();
      if (!itemId) { toast("No inventory item available (seed failed).", "error"); return; }
      const shortId = Math.random().toString(36).slice(2, 8);
      if (__DEV__) console.log("[PO] Creating draft with vendorId:", vendorId, "itemId:", itemId);
      const po = await apiClient.post<any>("/objects/purchaseOrder", {
        type: "purchaseOrder" as any,
        status: "draft" as any,
        vendorId,
        lines: [{ id: `L${shortId}`, itemId, qty: 1, uom: "ea" }],
      });
      const poId = (po as any)?.id ?? (po as any)?.body?.id;
      if (!poId) throw new Error("Purchase order create failed");
      toast(`✓ Created PO: ${poId}`, "success");
      scrollToTopOnNextFocus.current = true;
      navigation.navigate("PurchaseOrderDetail", { id: poId });
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
        placeholder="Search purchase orders"
        placeholderTextColor={t.colors.textMuted}
        value={q}
        onChangeText={setQ}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, marginBottom: 12, backgroundColor: t.colors.card, color: t.colors.text }}
      />
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <Pressable
          onPress={createDraft}
          style={{
            flex: 1,
            backgroundColor: t.colors.primary,
            padding: 12,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>+ New PO</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowViewPicker(true)}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: t.colors.primary, fontWeight: "600" }}>
            📋 Views
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSaveModalOpen(true)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: t.colors.primary, fontWeight: "600", fontSize: 12 }}>
            {appliedView ? "Update" : "Save"}
          </Text>
        </Pressable>
      </View>
      {isLoading && !data ? <ActivityIndicator /> : (
        <FlatList
          ref={listRef}
          data={items}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate("PurchaseOrderDetail", { id: item.id })}>
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

      <ViewPickerModal
        visible={showViewPicker}
        onClose={() => setShowViewPicker(false)}
        onSelect={handleApplyView}
        entityType="purchaseOrder"
      />
      <SaveViewModal
        visible={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSaved={handleViewSaved}
        entityType="purchaseOrder"
        currentState={{ q, filter: filters.filter, sort: filters.sort }}
        appliedView={appliedView}
      />
    </View>
  );
}
