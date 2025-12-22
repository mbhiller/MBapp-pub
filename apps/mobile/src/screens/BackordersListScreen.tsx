// List "open" BackorderRequest rows with bulk Ignore/Convert, vendor filter, and drill to created POs.
import * as React from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, TextInput, Alert, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { useColors } from "../features/_shared/useColors";
import { apiClient } from "../api/client";
import DraftChooserModal, { PurchaseOrderDraft as Draft } from "../features/purchasing/DraftChooserModal";

type Row = { id: string; itemId: string; qty: number; status: string; preferredVendorId?: string | null };

export default function BackordersListScreen() {
  const nav = useNavigation<any>();
  const t = useColors();
  const [vendorFilter, setVendorFilter] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [chooserDrafts, setChooserDrafts] = React.useState<Draft[]>([]);
  const { data, isLoading, refetch } = useObjects<Row>({
    type: "backorderRequest",
    q: "open",
    query: { sort: "desc", by: "updatedAt" },
    params: { limit: __DEV__ ? 200 : 50 },
  });

  const rawItems: Row[] = data?.items ?? [];
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

  const filtered = vendorFilter.trim()
    ? items.filter((r) => (r as any)?.preferredVendorId === vendorFilter.trim())
    : items;

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function bulk(action: "ignore" | "convert") {
    const picks = Object.keys(selected).filter((k) => selected[k]);
    if (picks.length === 0) return;
    for (const id of picks) {
      await apiClient.post(`/objects/backorderRequest/${encodeURIComponent(id)}:${action}`, {});
    }
    await refetch?.();

    // If converting and vendor filter is set, offer suggest-po and drill to drafts.
    if (action === "convert") {
      try {
        const reqs = picks.map((id) => ({ backorderRequestId: id }));
        const res = (await apiClient.post(`/purchasing/suggest-po`, {
          requests: reqs,
          vendorId: vendorFilter || null,
        })) as unknown as Response;
        const j: any = await (res as any).json();
        const drafts: Draft[] = Array.isArray(j?.drafts) ? j.drafts : (j?.draft ? [j.draft] : []);
        if (drafts.length === 1) {
          nav.navigate("PurchaseOrderDetail", { id: drafts[0].id, mode: "draft" });
        } else if (drafts.length > 1) {
          setChooserDrafts(drafts);
          setChooserOpen(true);
        }
      } catch (e) {
        Alert.alert("Draft creation", "Converted backorders; failed to open draft(s).");
      }
    }
    setSelected({});
  }

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => { void refetch?.(); });
      return () => task.cancel?.();
    }, [refetch])
  );

  const isNew = (iso?: string) => {
    if (!iso) return false;
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < 10 * 60 * 1000;
  };

  if (isLoading && !data) return <ActivityIndicator />;

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      <DraftChooserModal
        visible={chooserOpen}
        drafts={chooserDrafts}
        onPick={(d) => {
          setChooserOpen(false);
          nav.navigate("PurchaseOrderDetail", { id: d.id, mode: "draft" });
        }}
        onClose={() => setChooserOpen(false)}
      />
      <Text style={{ fontWeight: "700", marginBottom: 12 }}>Backorders</Text>

      {/* Vendor filter */}
      <View style={{ marginBottom: 12 }}>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 6 }}>Vendor</Text>
        <TextInput
          value={vendorFilter}
          onChangeText={setVendorFilter}
          placeholder="vendorId (optional)"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, backgroundColor: t.colors.card, color: t.colors.text }}
        />
      </View>

      {/* Bulk action buttons */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <Pressable
          onPress={() => bulk("ignore")}
          disabled={selectedCount === 0}
          style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: selectedCount === 0 ? t.colors.border : t.colors.primary, borderRadius: 8, alignItems: "center" }}
        >
          <Text style={{ color: selectedCount === 0 ? t.colors.textMuted : t.colors.buttonText || "#fff", fontWeight: "600", fontSize: 12 }}>Ignore Selected</Text>
        </Pressable>
        <Pressable
          onPress={() => bulk("convert")}
          disabled={selectedCount === 0}
          style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: selectedCount === 0 ? t.colors.border : t.colors.primary, borderRadius: 8, alignItems: "center" }}
        >
          <Text style={{ color: selectedCount === 0 ? t.colors.textMuted : t.colors.buttonText || "#fff", fontWeight: "600", fontSize: 12 }}>Convert Selected</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => toggle(item.id)}
            style={{
              padding: 10,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              marginBottom: 8,
              backgroundColor: selected[item.id] ? `${t.colors.primary}20` : t.colors.card,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
              <Text style={{ color: t.colors.text, fontWeight: "700" }}>{item.itemId}</Text>
              {isNew((item as any).createdAt) && (
                <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: t.colors.primary }}>
                  <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
                </View>
              )}
            </View>
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
              Qty: {item.qty} • Status: {item.status}
            </Text>
            {"preferredVendorId" in item && item.preferredVendorId ? (
              <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Preferred Vendor: {String((item as any).preferredVendorId)}</Text>
            ) : null}
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Tap to {selected[item.id] ? "unselect" : "select"}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
