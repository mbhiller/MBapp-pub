import * as React from "react";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { apiClient } from "../../api/client";

type Row = { id: string; qty: number; lot?: string; locationId?: string; at: string; refId?: string; poLineId?: string };
type Page = { items: Row[]; next?: string | null; pageInfo?: { hasNext?: boolean; nextCursor?: string | null } };
function rel(iso: string) {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
export function ReceiveHistorySheet({
  itemId, poId, lineId, visible, onClose,
}: { itemId: string; poId: string; lineId: string; visible: boolean; onClose: () => void }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setRows([]); setCursor(null);
    void load();
  }, [visible, itemId, poId, lineId]);

  async function load(next?: string | null) {
    setLoading(true);
    try {
      const res: Page = await apiClient.getQ(`/inventory/${itemId}/movements`, {
        refId: poId, poLineId: lineId, next: next ?? undefined, limit: 50, sort: "desc",
      });
      setRows(prev => [...prev, ...(res?.items ?? [])]);
      const nc = res?.pageInfo?.nextCursor ?? res?.next ?? null;
      setCursor(nc || null);
    } catch {
      // swallow and render whatever we have
    } finally { setLoading(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, maxHeight: "70%" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontWeight: "700", fontSize: 16 }}>Recent Receives</Text>
            <Pressable onPress={onClose}><Text style={{ color: "#1e88e5" }}>Close</Text></Pressable>
          </View>
          <ScrollView>
            {rows.length === 0 && !loading && <Text style={{ color: "#666" }}>No receives yet.</Text>}
            {rows.map(r => (
                <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee", rowGap: 4 }}>
                <Text style={{ fontWeight: "600" }}>{r.qty} received</Text>
                <View style={{ flexDirection: "row", columnGap: 8, rowGap: 4, flexWrap: "wrap" }}>
                    {!!r.lot && (
                    <View style={{ backgroundColor: "#eef2ff", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                        <Text style={{ fontSize: 12 }}>lot: {r.lot}</Text>
                    </View>
                    )}
                    {!!r.locationId && (
                    <View style={{ backgroundColor: "#ecfdf5", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                        <Text style={{ fontSize: 12 }}>loc: {r.locationId}</Text>
                    </View>
                    )}
                    <View style={{ backgroundColor: "#f3f4f6", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                    <Text style={{ fontSize: 12 }}>{rel(r.at)}</Text>
                    </View>
                </View>
                </View>
            ))}
            {loading && <ActivityIndicator />}
            {!!cursor && !loading && (
              <Pressable onPress={() => load(cursor)} style={{ paddingVertical: 12 }}>
                <Text style={{ color: "#1e88e5", textAlign: "center" }}>Load more</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
