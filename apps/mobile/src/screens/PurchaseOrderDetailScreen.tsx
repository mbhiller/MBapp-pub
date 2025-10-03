import React from "react";
import { ScrollView, View, Text, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useColors } from "../features/_shared/useColors";
import { apiClient, getObject } from "../api/client";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

type Route = RouteProp<RootStackParamList, "PurchaseOrderDetail">;

export default function PurchaseOrderDetailScreen() {
  const route = useRoute<Route>();
  const { id } = route.params ?? {};
  const t = useColors();

  const [po, setPo] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const obj = await getObject<any>("purchaseOrder", String(id));
      setPo(obj);
    } finally { setLoading(false); }
  }, [id]);

  // 🔧 Fix: no deps array — the hook signature is (fn, opts?)
  useRefetchOnFocus(load);

  React.useEffect(() => { load(); }, [load]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const canSubmit  = po?.status === "draft";
  const canApprove = po?.status === "submitted";
  const canReceive = ["approved", "partially_received"].includes(po?.status);

  const Btn = ({ label, onPress, disabled }: { label: string; onPress: () => void | Promise<void>; disabled?: boolean }) => (
    <Pressable
      onPress={() => { const p = onPress(); if (p && (p as any).then) (p as Promise<any>).catch(()=>{}); }}
      disabled={!!disabled || busy}
      style={{
        backgroundColor: disabled || busy ? t.colors.disabled : t.colors.primary,
        paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, marginRight: 8, marginTop: 8
      }}>
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );

  async function submit() {
    setBusy(true);
    try {
      await apiClient.post(`/purchasing/po/${encodeURIComponent(String(id))}:submit`, {});
      await load();
    } catch (e: any) { Alert.alert("Submit failed", e?.message ?? "Error"); }
    finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true);
    try {
      await apiClient.post(`/purchasing/po/${encodeURIComponent(String(id))}:approve`, {});
      await load();
    } catch (e: any) { Alert.alert("Approve failed", e?.message ?? "Error"); }
    finally { setBusy(false); }
  }
  async function receiveAll() {
    const lines = (po?.lines || []).map((l: any) => {
      const remaining = Math.max(0, Number(l.qty ?? 0) - Number(l.qtyReceived ?? 0));
      return remaining > 0 ? { lineId: String(l.id ?? l.lineId), deltaQty: remaining } : null;
    }).filter(Boolean) as any[];
    if (lines.length === 0) { Alert.alert("Nothing to receive"); return; }
    setBusy(true);
    try {
      await apiClient.post(`/purchasing/po/${encodeURIComponent(String(id))}:receive`, { lines });
      await load();
    } catch (e: any) { Alert.alert("Receive failed", e?.message ?? "Error"); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl tintColor={t.colors.text} refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>Purchase Order</Text>
      {loading ? <ActivityIndicator /> : (
        <View style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }}>
          <Row label="ID" value={String(po?.id ?? "—")} />
          <Row label="Order #" value={String(po?.orderNumber ?? "—")} />
          <Row label="Vendor" value={String(po?.vendorName ?? po?.vendorId ?? "—")} />
          <Row label="Status" value={String(po?.status ?? "—")} />
          {!!po?.notes && <Row label="Notes" value={String(po.notes)} />}

          <Text style={{ color: t.colors.text, fontWeight: "700", marginTop: 12, marginBottom: 6 }}>Lines</Text>
          {(po?.lines ?? []).map((l: any, i: number) => (
            <View key={i} style={{ padding: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, marginBottom: 6 }}>
              <Text style={{ color: t.colors.text, fontWeight: "600" }}>
                {l.qty} {l.uom} (recv {l.qtyReceived ?? 0})
              </Text>
              <Text style={{ color: t.colors.muted, fontSize: 12 }}>itemId: {l.itemId}</Text>
            </View>
          ))}

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12 }}>
            <Btn label="Submit" onPress={submit} disabled={!canSubmit} />
            <Btn label="Approve" onPress={approve} disabled={!canApprove} />
            <Btn label="Receive All" onPress={receiveAll} disabled={!canReceive} />
          </View>
        </View>
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", marginBottom: 6 }}>
      <Text style={{ color: t.colors.muted, width: 110 }}>{label}</Text>
      <Text style={{ color: t.colors.text, flex: 1 }}>{value || "—"}</Text>
    </View>
  );
}
