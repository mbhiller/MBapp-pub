// apps/mobile/src/screens/PurchaseOrdersListScreen.tsx
import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { useTheme } from "../providers/ThemeProvider";
import { apiClient } from "../api/client";
import { useToast } from "../features/_shared/Toast";
import { createParty, addPartyRole } from "../features/parties/api";
import { upsertInventoryItem } from "../features/inventory/api"

export default function PurchaseOrdersListScreen() {
  const navigation = useNavigation<any>();
  const t = useTheme();
  const toast = useToast();
  const listRef = React.useRef<any>(null);
  const scrollToTopOnNextFocus = React.useRef(false);
  const [q, setQ] = React.useState("");
  const { data, isLoading, refetch } = useObjects<any>({
    type: "purchaseOrder",
    q,
    query: { sort: "desc", by: "updatedAt" },
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
        } catch {}
      }
    } catch {}
    const shortId = Math.random().toString(36).slice(2, 8);
    const p = await createParty({ kind: "organization", name: `Seed Vendor - UI ${shortId}` });
    await addPartyRole(p.id, "vendor");
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
      const itemId = await ensureInventoryId();
      const shortId = Math.random().toString(36).slice(2, 8);
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

  const onNew = React.useCallback(() => {
    navigation.navigate("PurchaseOrderDetail", { mode: "new" });
  }, [navigation]);

  const isNew = (iso?: string) => {
    if (!iso) return false;
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < 10 * 60 * 1000;
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      <TextInput
        placeholder="Search purchase orders"
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
        <Text style={{ color: "#fff", fontWeight: "700" }}>+ New Purchase Order</Text>
      </Pressable>
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
    </View>
  );
}
