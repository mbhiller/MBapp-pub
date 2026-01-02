import * as React from "react";
import { View, Text, ActivityIndicator, ScrollView, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { useToast } from "../features/_shared/Toast";
import type { RootStackParamList } from "../navigation/types";
import {
  suggestPurchaseOrders,
  saveFromSuggestion,
  type PurchaseOrderDraft,
  type SuggestPoResponse,
} from "../features/purchasing/poActions";

function DraftCard({ draft }: { draft: PurchaseOrderDraft }) {
  const t = useColors();
  const lines = draft.lines || [];
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 10, padding: 12, backgroundColor: t.colors.card }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Text style={{ fontWeight: "700", color: t.colors.text }}>
          Vendor: {draft.vendorName ? `${draft.vendorName} (${draft.vendorId})` : draft.vendorId || "(unknown)"}
        </Text>
        {draft.status ? <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Status: {draft.status}</Text> : null}
      </View>
      {lines.length === 0 && <Text style={{ color: t.colors.textMuted }}>No lines suggested.</Text>}
      {lines.map((ln, idx) => (
        <View key={ln.id || ln.lineId || `${ln.itemId || "line"}-${idx}`} style={{ padding: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, marginTop: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
            <Text style={{ fontWeight: "600", color: t.colors.text }}>Item: {ln.itemId || "(unknown)"}</Text>
            <Text style={{ color: t.colors.text }}>
              Qty: {ln.qtySuggested ?? ln.qty ?? "—"}{ln.uom ? ` ${ln.uom}` : ""}
            </Text>
          </View>
          {ln.qtyRequested != null && ln.qtyRequested !== (ln.qtySuggested ?? ln.qty) && (
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
              Requested {ln.qtyRequested}{ln.uom ? ` ${ln.uom}` : ""}
            </Text>
          )}
          {(ln.minOrderQtyApplied != null || ln.adjustedFrom != null) && (
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
              {ln.minOrderQtyApplied != null ? `MOQ applied: ${ln.minOrderQtyApplied}` : ""}
              {ln.adjustedFrom != null ? ` (from ${ln.adjustedFrom})` : ""}
            </Text>
          )}
          {ln.backorderRequestIds?.length ? (
            <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 2 }}>
              Backorders: {ln.backorderRequestIds.join(", ")}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function SkippedCard({ id, reason, reasonCode }: { id?: string; reason?: string; reasonCode?: string }) {
  const t = useColors();
  return (
    <View style={{ padding: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, backgroundColor: t.colors.card }}>
      <Text style={{ fontWeight: "600", color: t.colors.text }}>Backorder: {id || "(unknown)"}</Text>
      <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>{reason || "No reason provided"}</Text>
      {reasonCode ? <Text style={{ color: t.colors.textMuted, fontSize: 11, marginTop: 2 }}>Code: {reasonCode}</Text> : null}
    </View>
  );
}

function formatError(err: unknown): string {
  const e = err as any;
  if (e?.message) return e.message;
  if (e?.status && e?.statusText) return `${e.status} ${e.statusText}`;
  return "Request failed";
}

export default function SuggestPurchaseOrdersScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "SuggestPurchaseOrders">>();
  const nav = useNavigation<any>();
  const t = useColors();
  const toast = useToast();

  const backorderRequestIds = route.params?.backorderRequestIds || [];
  const vendorId = route.params?.vendorId;

  const [resp, setResp] = React.useState<SuggestPoResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [createdIds, setCreatedIds] = React.useState<string[]>([]);

  const drafts = React.useMemo<PurchaseOrderDraft[]>(() => {
    if (resp?.drafts) return resp.drafts;
    return resp?.draft ? [resp.draft] : [];
  }, [resp]);
  const skipped = resp?.skipped || [];

  React.useEffect(() => {
    const load = async () => {
      if (!backorderRequestIds.length) {
        setError("Missing backorder IDs");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setActionError(null);
      setCreatedIds([]);
      try {
        const res = await suggestPurchaseOrders(backorderRequestIds, vendorId ? { vendorId } : {});
        setResp(res ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [backorderRequestIds.join("|"), vendorId]);

  const handleCreate = async () => {
    if (!drafts.length) {
      setActionError("No drafts to create");
      return;
    }
    setCreating(true);
    setActionError(null);
    try {
      const res = await saveFromSuggestion(drafts.length === 1 ? drafts[0] : drafts);
      const ids = res?.ids ?? (res?.id ? [res.id] : []);
      setCreatedIds(ids);
      if (ids.length) {
        nav.navigate("PurchaseOrderDetail", { id: ids[0] });
      }
    } catch (err) {
      const msg = formatError(err);
      setActionError(msg);
      toast(msg, "error");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: t.colors.textMuted }}>Suggesting purchase orders...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ color: "#b00020", marginBottom: 12 }}>Error: {error}</Text>
        <Pressable
          onPress={() => nav.goBack()}
          style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.colors.border, borderRadius: 8, alignSelf: "flex-start" }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 20, fontWeight: "700", color: t.colors.text }}>Suggest PO(s)</Text>
          <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>Backorder IDs: {backorderRequestIds.join(", ")}</Text>
          {vendorId ? <Text style={{ color: t.colors.textMuted }}>Vendor: {vendorId}</Text> : null}
        </View>
        <Pressable
          onPress={() => nav.goBack()}
          style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.colors.border, borderRadius: 8 }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>

      {actionError && (
        <View style={{ padding: 10, borderWidth: 1, borderColor: "#f5c6cb", backgroundColor: "#f8d7da", borderRadius: 8 }}>
          <Text style={{ color: "#721c24" }}>{actionError}</Text>
        </View>
      )}

      {createdIds.length > 0 && (
        <View style={{ padding: 10, borderWidth: 1, borderColor: "#c8e6c9", backgroundColor: "#e8f5e9", borderRadius: 8, marginBottom: 12 }}>
          <Text style={{ fontWeight: "600", color: t.colors.text, marginBottom: 6 }}>Created Purchase Orders:</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {createdIds.map((poId) => (
              <Pressable
                key={poId}
                onPress={() => nav.navigate("PurchaseOrderDetail", { id: poId })}
                style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: t.colors.primary, borderRadius: 6, marginRight: 8, marginBottom: 8 }}
              >
                <Text style={{ color: t.colors.buttonText || "#fff", fontWeight: "700" }}>{poId} →</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: t.colors.text, marginBottom: 6 }}>Drafts</Text>
        {drafts.length === 0 && <Text style={{ color: t.colors.textMuted }}>No drafts returned for these backorders.</Text>}
        {drafts.map((draft, idx) => (
          <View key={draft.vendorId || `draft-${idx}`} style={{ marginBottom: 8 }}>
            <DraftCard draft={draft} />
          </View>
        ))}
      </View>

      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: t.colors.text, marginBottom: 6 }}>Skipped</Text>
        {skipped.length === 0 && <Text style={{ color: t.colors.textMuted }}>No skipped backorders.</Text>}
        {skipped.map((s, idx) => {
          const friendlyReason = (s as any)?.reasonFriendly;
          const reasonCode = (s as any)?.reasonCode;
          return (
            <View key={s.backorderRequestId || `skip-${idx}`} style={{ marginBottom: 8 }}>
              <SkippedCard id={s.backorderRequestId} reason={friendlyReason ?? s.reason} reasonCode={reasonCode} />
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
        <Pressable
          onPress={handleCreate}
          disabled={creating || drafts.length === 0}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: creating || drafts.length === 0 ? t.colors.border : "#2e7d32",
            borderRadius: 10,
          }}
        >
          <Text style={{ color: creating || drafts.length === 0 ? t.colors.textMuted : "#fff", fontWeight: "700" }}>
            {creating ? "Creating..." : "Create PO(s)"}
          </Text>
        </Pressable>
        {drafts.length === 0 && <Text style={{ color: t.colors.textMuted, marginLeft: 8 }}>No drafts available to create.</Text>}
      </View>
    </ScrollView>
  );
}
