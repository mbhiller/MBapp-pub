import React from "react";
import { ScrollView, View, Text, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useColors } from "../features/_shared/useColors";
import { apiClient, getObject } from "../api/client";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

type Route = RouteProp<RootStackParamList, "SalesOrderDetail">;

export default function SalesOrderDetailScreen() {
  const route = useRoute<Route>();
  const { id } = route.params ?? {};
  const t = useColors();

  const [so, setSo] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const obj = await getObject<any>("salesOrder", String(id));
      setSo(obj);
    } finally { setLoading(false); }
  }, [id]);

  // 🔧 Fix: no deps array — the hook signature is (fn, opts?)
  useRefetchOnFocus(load);

  React.useEffect(() => { load(); }, [load]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const canSubmit  = so?.status === "draft";
  const canCommit  = so?.status === "submitted";
  const canFulfill = ["committed", "partially_fulfilled"].includes(so?.status);

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
      await apiClient.post(`/sales/so/${encodeURIComponent(String(id))}:submit`, {});
      await load();
    } catch (e: any) { Alert.alert("Submit failed", e?.message ?? "Error"); }
    finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true);
    try {
      await apiClient.post(`/sales/so/${encodeURIComponent(String(id))}:commit`, {});
      await load();
    } catch (e: any) { Alert.alert("Commit failed", e?.message ?? "Error"); }
    finally { setBusy(false); }
  }
  async function fulfillAll() {
    const lines = (so?.lines || []).map((l: any) => {
      const remaining = Math.max(0, Number(l.qty ?? 0) - Number(l.qtyFulfilled ?? 0));
      return remaining > 0 ? { lineId: String(l.id ?? l.lineId), deltaQty: remaining } : null;
    }).filter(Boolean) as any[];
    if (lines.length === 0) { Alert.alert("Nothing to fulfill"); return; }
    setBusy(true);
    try {
      await apiClient.post(`/sales/so/${encodeURIComponent(String(id))}:fulfill`, { lines });
      await load();
    } catch (e: any) { Alert.alert("Fulfill failed", e?.message ?? "Error"); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl tintColor={t.colors.text} refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>Sales Order</Text>
      {loading ? <ActivityIndicator /> : (
        <View style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }}>
          <Row label="ID" value={String(so?.id ?? "—")} />
          <Row label="Order #" value={String(so?.orderNumber ?? "—")} />
          <Row label="Customer" value={String(so?.customerName ?? so?.customerId ?? "—")} />
          <Row label="Status" value={String(so?.status ?? "—")} />
          {!!so?.notes && <Row label="Notes" value={String(so.notes)} />}

          <Text style={{ color: t.colors.text, fontWeight: "700", marginTop: 12, marginBottom: 6 }}>Lines</Text>
          {(so?.lines ?? []).map((l: any, i: number) => (
            <View key={i} style={{ padding: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, marginBottom: 6 }}>
              <Text style={{ color: t.colors.text, fontWeight: "600" }}>
                {l.qty} {l.uom} (ful {l.qtyFulfilled ?? 0})
              </Text>
              <Text style={{ color: t.colors.muted, fontSize: 12 }}>itemId: {l.itemId}</Text>
            </View>
          ))}

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12 }}>
            <Btn label="Submit" onPress={submit} disabled={!canSubmit} />
            <Btn label="Commit" onPress={commit} disabled={!canCommit} />
            <Btn label="Fulfill All" onPress={fulfillAll} disabled={!canFulfill} />
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
