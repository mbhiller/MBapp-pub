// apps/mobile/src/screens/GoodsReceiptDetailScreen.tsx
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "../features/_shared/useColors";
import { newIdempotencyKey } from "../features/_shared/useIdempotencyKey";
import { getObject } from "../api/client";
import { receivePO } from "../features/purchaseOrders/api";
import type { RootStackParamList } from "../navigation/types";
import type { PurchaseOrder } from "../features/purchaseOrders/api";

type Route = RouteProp<RootStackParamList, "GoodsReceiptDetail">;

type ReceiveLine = {
  lineId: string;
  deltaQty: number;
  lot?: string;
  locationId?: string;
};

export default function GoodsReceiptDetailScreen() {
  const { params } = useRoute<Route>();
  const rawParams = (params as any) || {};
  const poId: string | undefined = rawParams.poId ?? rawParams.id;
  const navigation = useNavigation<any>();
  const t = useColors();

  const [loading, setLoading] = React.useState(true);
  const [posting, setPosting] = React.useState(false);
  const [po, setPO] = React.useState<PurchaseOrder | null>(null);
  const [recv, setRecv] = React.useState<Record<string, ReceiveLine>>({});
  const [idemKey, setIdemKey] = React.useState<string>(newIdempotencyKey());

  const load = React.useCallback(async () => {
    if (!poId) return;
    setLoading(true);
    try {
      const doc = await getObject<PurchaseOrder>("purchaseOrder", poId);
      const seeded = (doc.lines || []).reduce((acc, l) => {
        acc[l.id] = { lineId: l.id, deltaQty: 0 };
        return acc;
      }, {} as Record<string, ReceiveLine>);
      setPO(doc);
      setRecv(seeded);
    } catch (e: any) {
      Alert.alert("Load failed", e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [poId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const remaining = React.useMemo(() => {
    const map: Record<string, number> = {};
    (po?.lines || []).forEach((l) => {
      const ordered = Math.max(0, Number(l.qty ?? 0));
      const received = Math.max(0, Number(l.qtyReceived ?? 0));
      map[l.id] = Math.max(0, ordered - received);
    });
    return map;
  }, [po]);

  const setDelta = (lineId: string, deltaQty: number) => {
    setRecv((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] || { lineId }), deltaQty } }));
  };

  const bump = (lineId: string, by: number) => {
    const current = recv[lineId]?.deltaQty ?? 0;
    const next = Math.max(0, current + by);
    const cap = remaining[lineId] ?? Infinity;
    setDelta(lineId, Math.min(next, cap));
  };

  const receiveAllRemaining = () => {
    const next: Record<string, ReceiveLine> = {};
    (po?.lines || []).forEach((l) => {
      const left = remaining[l.id] ?? 0;
      next[l.id] = { lineId: l.id, deltaQty: left };
    });
    setRecv(next);
  };

  const postReceipt = async () => {
    if (!po) return;
    const lines: ReceiveLine[] = Object.values(recv).filter((r) => (r.deltaQty || 0) > 0);
    if (!lines.length) {
      Alert.alert("Nothing to receive", "Enter at least one quantity > 0.");
      return;
    }
    setPosting(true);
    try {
      // Minimal type-safe call: your receivePO expects ReceiveLine[]
      await receivePO(String(po.id), lines);
      setIdemKey(newIdempotencyKey()); // rotate after use (safe even if not passed)
      Alert.alert("Received", "Goods receipt posted.");
      navigation.goBack(); // PO detail rehydrates on focus
    } catch (e: any) {
      Alert.alert("Receive failed", e?.message || String(e));
    } finally {
      setPosting(false);
    }
  };

  if (!poId) {
    return <Centered><Text>Missing poId</Text></Centered>;
  }
  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading PO…</Text>
      </Centered>
    );
  }
  if (!po) {
    return <Centered><Text>PO not found</Text></Centered>;
  }

  return (
    <KeyboardAvoidingScreen>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
        <Card title="Goods Receipt">
          <Row label="PO #" value={po.poNumber || po.id} />
          <Row label="Vendor" value={po.vendorName || po.vendorId || "—"} />
          <Row label="Status" value={po.status} />
        </Card>

        <Collapsible title="Lines to Receive" defaultOpen>
          <View style={{ gap: 8 }}>
            {(po.lines || []).map((ln) => {
              const left = remaining[ln.id] ?? 0;
              const val = recv[ln.id]?.deltaQty ?? 0;
              return (
                <View
                  key={ln.id}
                  style={{
                    borderWidth: 1,
                    borderColor: t.colors.border,
                    borderRadius: 12,
                    padding: 12,
                    gap: 8,
                    backgroundColor: t.colors.card,
                  }}
                >
                  <Text style={{ fontWeight: "600" }}>{ln.itemId}</Text>
                  <Text style={{ color: t.colors.textMuted }}>
                    Ordered {ln.qty} • Received {ln.qtyReceived ?? 0} • Remaining {left}
                  </Text>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <IconBtn onPress={() => bump(ln.id, -1)} icon="minus" />
                    <TextInput
                      keyboardType="numeric"
                      value={String(val)}
                      onChangeText={(txt) => {
                        const n = Number(txt.replace(/[^\d.]/g, "")) || 0;
                        setDelta(ln.id, Math.min(n, left));
                      }}
                      style={{
                        flex: 1,
                        borderWidth: 1,
                        borderColor: t.colors.border,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        backgroundColor: t.colors.background,
                      }}
                    />
                    <IconBtn onPress={() => bump(ln.id, +1)} icon="plus" />
                    <Pressable
                      onPress={() => setDelta(ln.id, left)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderWidth: 1,
                        borderColor: t.colors.border,
                        borderRadius: 8,
                      }}
                    >
                      <Text>All</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={receiveAllRemaining}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 10,
              }}
            >
              <Text>Receive All Remaining</Text>
            </Pressable>
          </View>
        </Collapsible>

        <Pressable
          onPress={postReceipt}
          disabled={posting}
          style={{
            marginTop: 8,
            backgroundColor: posting ? t.colors.textMuted : t.colors.primary,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          {posting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "700" }}>Post Receipt</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

/* — shared UI bits — */
function KeyboardAvoidingScreen({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={64}
    >
      <View style={{ flex: 1 }}>{children}</View>
    </KeyboardAvoidingView>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>{children}</View>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useColors();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.colors.border,
        borderRadius: 12,
        padding: 12,
        gap: 8,
        backgroundColor: t.colors.card,
      }}
    >
      <Text style={{ fontWeight: "700", fontSize: 16 }}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  const t = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: t.colors.text, fontSize: 14 }}>{value ?? "—"}</Text>
    </View>
  );
}

function Collapsible({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const t = useColors();
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.colors.border,
        borderRadius: 12,
        backgroundColor: t.colors.card,
      }}
    >
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 12,
        }}
      >
        <Text style={{ fontWeight: "700" }}>{title}</Text>
        <Text style={{ fontSize: 16 }}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>{children}</View> : null}
    </View>
  );
}

function IconBtn({ onPress, icon }: { onPress: () => void; icon: "plus" | "minus" }) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{ padding: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8 }}
    >
      <Feather name={icon} size={16} color={t.colors.text} />
    </Pressable>
  );
}
