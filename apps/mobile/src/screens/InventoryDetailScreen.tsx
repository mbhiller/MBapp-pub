import React from "react";
import { ScrollView, View, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useColors } from "../features/_shared/useColors";
import { apiClient, getObject } from "../api/client";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

type Route = RouteProp<RootStackParamList, "InventoryDetail">;

type Movement = {
  id?: string;
  ts?: string;            // ISO
  qty?: number;
  kind?: "in" | "out";
  refType?: string;       // "purchaseOrder" | "salesOrder" | "adjustment"
  refId?: string;
  notes?: string;
};

export default function InventoryDetailScreen() {
  const route = useRoute<Route>();
  const { id } = route.params ?? {};
  const t = useColors();

  const [item, setItem] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  // stock card state
  const [onhand, setOnhand] = React.useState<number | null>(null);
  const [movements, setMovements] = React.useState<Movement[]>([]);
  const [stockBusy, setStockBusy] = React.useState(false);

  const loadStock = React.useCallback(async () => {
    if (!id) return;
    setStockBusy(true);
    try {
      const oh = await apiClient.get<{ onhand: number }>(`/inventory/${encodeURIComponent(String(id))}/onhand`);
      const mv = await apiClient.get<{ items?: Movement[] }>(`/inventory/${encodeURIComponent(String(id))}/movements`);
      setOnhand((oh as any)?.onhand ?? (oh as any));
      const list: Movement[] = Array.isArray((mv as any)?.items) ? (mv as any).items : (Array.isArray(mv) ? (mv as any) : []);
      setMovements(list.sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 10));
    } catch { /* noop */ } finally { setStockBusy(false); }
  }, [id]);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const obj = await getObject<any>("inventory", String(id));
      setItem(obj);
      await loadStock();
    } finally { setLoading(false); }
  }, [id, loadStock]);

  // 🔧 Fix: no deps array — the hook signature is (fn, opts?)
  useRefetchOnFocus(load);

  React.useEffect(() => { load(); }, [load]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const Card = ({ children }: { children: React.ReactNode }) => (
    <View style={{
      backgroundColor: t.colors.card,
      borderColor: t.colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 12
    }}>
      {children}
    </View>
  );

  if (!id) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.background }}>
        <Text style={{ color: t.colors.text }}>No item id</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl tintColor={t.colors.text} refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
        Inventory Item
      </Text>
      {loading && <View style={{ paddingVertical: 16 }}><ActivityIndicator /></View>}

      <Card>
        <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>{item?.name || item?.label || item?.id}</Text>
        <Row label="ID" value={String(item?.id ?? "")} />
        <Row label="Product" value={String(item?.productId ?? "—")} />
        <Row label="UOM" value={String(item?.uom ?? "—")} />
        <Row label="Status" value={String(item?.status ?? "—")} />
        {item?.notes ? <Row label="Notes" value={String(item.notes)} /> : null}
      </Card>

      <Card>
        <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>Stock</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
          <Text style={{ color: t.colors.muted, marginRight: 8 }}>On hand:</Text>
          {stockBusy ? <ActivityIndicator /> : (
            <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>
              {onhand ?? "—"}
            </Text>
          )}
          <Pressable onPress={loadStock} style={{ marginLeft: "auto", backgroundColor: t.colors.primary, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 }}>
            <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>Refresh</Text>
          </Pressable>
        </View>

        <Text style={{ color: t.colors.muted, marginBottom: 6 }}>Recent movements</Text>
        <View style={{ gap: 6 }}>
          {movements.length === 0 ? (
            <Text style={{ color: t.colors.muted }}>No movements</Text>
          ) : movements.map((m, idx) => (
            <View key={idx} style={{
              padding: 8,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              backgroundColor: t.colors.bg
            }}>
              <Text style={{ color: t.colors.text, fontWeight: "600" }}>
                {m.kind === "in" ? "↑ In" : m.kind === "out" ? "↓ Out" : "•"} {m.qty ?? 0} {item?.uom ?? ""}
              </Text>
              <Text style={{ color: t.colors.muted, fontSize: 12 }}>
                {m.ts ? new Date(m.ts).toLocaleString() : "—"}
                {m.refType ? `  •  ${m.refType}${m.refId ? ` #${m.refId}` : ""}` : ""}
              </Text>
              {!!m.notes && <Text style={{ color: t.colors.muted, fontSize: 12 }}>{m.notes}</Text>}
            </View>
          ))}
        </View>
      </Card>

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
