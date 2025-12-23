// List "open" BackorderRequest rows with bulk Ignore/Convert, vendor filter, and drill to created POs.
import * as React from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, Alert, InteractionManager } from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { useColors } from "../features/_shared/useColors";
import { apiClient } from "../api/client";
import DraftChooserModal, { PurchaseOrderDraft as Draft } from "../features/purchasing/DraftChooserModal";
import { saveFromSuggestion } from "../features/purchasing/poActions";
import { useToast } from "../features/_shared/Toast";
import { copyText } from "../features/_shared/copy";
import { VendorPicker } from "../features/_shared/fields";

type Row = { id: string; itemId: string; qty: number; status: string; preferredVendorId?: string | null };

export default function BackordersListScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const soId = route.params?.soId as string | undefined;
  const itemId = route.params?.itemId as string | undefined;
  const status = route.params?.status as "open" | "ignored" | "converted" | undefined;
  const preferredVendorId = route.params?.preferredVendorId as string | undefined;
  const t = useColors();
  const toast = useToast();
  const [vendorFilter, setVendorFilter] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [chooserDrafts, setChooserDrafts] = React.useState<Draft[]>([]);

  React.useEffect(() => {
    setVendorFilter(preferredVendorId ?? "");
  }, [preferredVendorId]);

  const filter = {
    status: status ?? "open",
    ...(soId ? { soId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(preferredVendorId ? { preferredVendorId } : {}),
  };
  const { data, isLoading, refetch } = useObjects<Row>({
    type: "backorderRequest",
    filter,
    query: { sort: "desc", by: "updatedAt" },
    params: { limit: __DEV__ ? 200 : 50 },
  });

  const rawItems: Row[] = data?.items ?? [];
  const items = React.useMemo(() => {
    return [...rawItems].sort((a, b) => {
      const ta = Date.parse((a as any)?.updatedAt ?? "") || Date.parse((a as any)?.createdAt ?? "") || 0;
      const tb = Date.parse((b as any)?.updatedAt ?? "") || Date.parse((b as any)?.createdAt ?? "") || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  }, [rawItems]);

  const filtered = React.useMemo(() => {
    let result = items;
    if (vendorFilter.trim()) {
      result = result.filter((r) => (r as any)?.preferredVendorId === vendorFilter.trim());
    }
    return result;
  }, [items, vendorFilter]);

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function bulk(action: "ignore" | "convert") {
    const picks = Object.keys(selected).filter((k) => selected[k]);
    if (picks.length === 0) return;
    
    // Step 1: Convert each backorder
    for (const id of picks) {
      await apiClient.post(`/objects/backorderRequest/${encodeURIComponent(id)}:${action}`, {});
    }
    await refetch?.();

    // Step 2: If converting, suggest-po and create draft(s)
    if (action === "convert") {
      try {
        const reqs = picks.map((id) => ({ backorderRequestId: id }));
        const vendorIdOverride = preferredVendorId ?? (vendorFilter.trim() || null);
        const res = await apiClient.post(`/purchasing/suggest-po`, {
          requests: reqs,
          vendorId: vendorIdOverride,
        });
        const j: any = (res as any)?.body ?? res;

        const skipped = Array.isArray(j?.skipped) ? j.skipped : [];
        if (skipped.length > 0) {
          const reasons = skipped
            .slice(0, 2)
            .map((s: any) => s?.reason || "SKIPPED")
            .join(", ");
          const suffix = skipped.length > 2 ? "…" : "";
          toast(`Skipped ${skipped.length} backorder(s): ${reasons}${suffix}`, "success");
        }

        const draftsFromArray: Draft[] = Array.isArray(j?.drafts) ? j.drafts : [];
        const singleDraft: Draft | undefined = j?.draft;
        const drafts: Draft[] = draftsFromArray.length > 0 ? draftsFromArray : singleDraft ? [singleDraft] : [];

        if (drafts.length === 0) {
          if (skipped.length === 0) {
            toast("No drafts returned", "success");
          }
          setSelected({});
          return;
        }
        
        // Step 3: Handle single draft or multiple drafts
        if (drafts.length === 1) {
          // Single draft: save and navigate immediately
          const createRes: any = await saveFromSuggestion(drafts[0]);
          const createdId = createRes?.id ?? createRes?.ids?.[0];
          if (createdId) {
            toast("Draft PO created", "success");
            nav.navigate("PurchaseOrderDetail", { id: createdId });
          }
        } else if (drafts.length > 1) {
          // Multiple drafts: show chooser modal
          setChooserDrafts(drafts);
          setChooserOpen(true);
        }
      } catch (e: any) {
        console.error(e);
        Alert.alert("Draft creation", e?.message || "Converted backorders; failed to create draft(s).");
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

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  if (isLoading && !data) return <ActivityIndicator />;

  const selectedCount = Object.values(selected).filter(Boolean).length;

  const hasActiveFilters = soId || itemId || (status !== "open") || preferredVendorId;

  const copyAndToast = async (value?: string | null) => {
    if (!value) return;
    try {
      await copyText(String(value));
      toast("Copied", "success");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {/* Multi-filter banner */}
      {hasActiveFilters && (
        <View style={{ marginBottom: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#e3f2fd", borderRadius: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 12, color: "#1976d2", fontWeight: "500" }}>Filters: status={status || "open"}</Text>
            {soId && (
              <Pressable onPress={() => copyAndToast(soId)}>
                <Text style={{ fontSize: 12, color: "#1976d2", fontWeight: "500" }}>· soId={soId}</Text>
              </Pressable>
            )}
            {itemId && (
              <Pressable onPress={() => copyAndToast(itemId)}>
                <Text style={{ fontSize: 12, color: "#1976d2", fontWeight: "500" }}>· itemId={itemId}</Text>
              </Pressable>
            )}
            {preferredVendorId && (
              <Pressable onPress={() => copyAndToast(preferredVendorId)}>
                <Text style={{ fontSize: 12, color: "#1976d2", fontWeight: "500" }}>· vendor={preferredVendorId}</Text>
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => nav.setParams({ soId: undefined, itemId: undefined, status: undefined, preferredVendorId: undefined })} style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
            <Text style={{ fontSize: 12, color: "#1976d2", fontWeight: "600" }}>Clear All</Text>
          </Pressable>
        </View>
      )}
      <DraftChooserModal
        visible={chooserOpen}
        drafts={chooserDrafts}
        onPick={async (d) => {
          try {
            const createRes: any = await saveFromSuggestion(d);
            const createdId = createRes?.id ?? createRes?.ids?.[0];
            if (createdId) {
              toast("Draft PO created", "success");
              setChooserOpen(false);
              nav.navigate("PurchaseOrderDetail", { id: createdId });
            }
          } catch (e: any) {
            console.error(e);
            Alert.alert("Error", e?.message || "Failed to create PO from draft");
          }
        }}
        onClose={() => setChooserOpen(false)}
      />
      <Text style={{ fontWeight: "700", marginBottom: 12 }}>Backorders</Text>

      {/* Vendor filter */}
      <View style={{ marginBottom: 12 }}>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 6 }}>Vendor</Text>
        <VendorPicker
          placeholder="Search vendors..."
          initialText={vendorFilter}
          debounceMs={220}
          minChars={1}
          onSelect={(r) => {
            const id = String(r.id);
            setVendorFilter(id);
            nav.setParams({ preferredVendorId: id });
          }}
        />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
          <Pressable
            onPress={() => {
              nav.setParams({ preferredVendorId: undefined });
              setVendorFilter("");
            }}
            style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: t.colors.border }}
          >
            <Text style={{ color: t.colors.textMuted, fontWeight: "600", fontSize: 12 }}>Clear Vendor</Text>
          </Pressable>
        </View>
      </View>

      {/* No modal; inline VendorPicker is used */}

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
            <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 2 }}>Qty: {item.qty} • Status: {item.status}</Text>
            {"preferredVendorId" in item && item.preferredVendorId ? (
              <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 2 }}>Vendor: {String((item as any).preferredVendorId)}</Text>
            ) : null}
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Updated: {formatDateTime((item as any).updatedAt) || "—"}</Text>
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Created: {formatDateTime((item as any).createdAt) || "—"}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
