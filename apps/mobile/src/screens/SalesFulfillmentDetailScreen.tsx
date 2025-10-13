// apps/mobile/src/screens/SalesFulfillmentDetailScreen.tsx
import * as React from "react";
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { Feather } from "@expo/vector-icons";
import { getObject } from "../api/client";
import { newIdempotencyKey } from "../features/_shared/useIdempotencyKey";
import { postFulfillment } from "../features/fulfillments/actions";
import type { RootStackParamList } from "../navigation/types";

type Route = RouteProp<RootStackParamList, "SalesFulfillmentDetail">;

type SalesOrder = {
  id: string;
  soNumber?: string;
  customerId?: string;
  customerName?: string;
  status: string;
  lines?: Array<{ id: string; itemId: string; qtyOrdered: number; qtyCommitted?: number; qtyFulfilled?: number }>;
};

type FulfillLine = { lineId: string; deltaQty: number; lot?: string; locationId?: string };

export default function SalesFulfillmentDetailScreen() {
  const { params } = useRoute<Route>();
  const rawParams = (params as any) || {};
  const soId: string | undefined = rawParams.soId ?? rawParams.id;
  const navigation = useNavigation<any>();
  const t = useColors();

  const [loading, setLoading] = React.useState(true);
  const [posting, setPosting] = React.useState(false);
  const [so, setSO] = React.useState<SalesOrder | null>(null);
  const [ff, setFF] = React.useState<Record<string, FulfillLine>>({});
  const [idemKey, setIdemKey] = React.useState<string>(newIdempotencyKey());

  const load = React.useCallback(async () => {
    if (!soId) return;
    setLoading(true);
    try {
      const doc = await getObject<SalesOrder>("salesOrder", soId);
      const seeded = (doc.lines || []).reduce((acc, l) => {
        acc[l.id] = { lineId: l.id, deltaQty: 0 };
        return acc;
      }, {} as Record<string, FulfillLine>);
      setSO(doc);
      setFF(seeded);
    } catch (e: any) {
      Alert.alert("Load failed", e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [soId]);

  React.useEffect(() => { load(); }, [load]);

  const remaining = React.useMemo(() => {
    const map: Record<string, number> = {};
    (so?.lines || []).forEach((l) => {
      const got = Math.max(0, l.qtyFulfilled ?? 0);
      const capBase = (l.qtyCommitted ?? (l.qtyOrdered ?? 0));
      map[l.id] = Math.max(0, capBase - got);
    });
    return map;
  }, [so]);

  const setDelta = (lineId: string, deltaQty: number) =>
    setFF((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] || { lineId }), deltaQty } }));

  const bump = (lineId: string, by: number) => {
    const current = ff[lineId]?.deltaQty ?? 0;
    const next = Math.max(0, current + by);
    const cap = remaining[lineId] ?? Infinity;
    setDelta(lineId, Math.min(next, cap));
  };

  const fulfillAllRemaining = () => {
    const next: Record<string, FulfillLine> = {};
    (so?.lines || []).forEach((l) => {
      const left = remaining[l.id] ?? 0;
      next[l.id] = { lineId: l.id, deltaQty: left };
    });
    setFF(next);
  };

  const post = async () => {
    if (!so) return;
    const lines = Object.values(ff).filter((r) => (r.deltaQty || 0) > 0);
    if (!lines.length) {
      Alert.alert("Nothing to fulfill", "Enter at least one quantity > 0.");
      return;
    }
    setPosting(true);
    try {
      await postFulfillment(so.id, { idempotencyKey: idemKey, lines });
      Alert.alert("Fulfilled", "Sales fulfillment posted.");
      setIdemKey(newIdempotencyKey()); // rotate after use
      navigation.goBack(); // SO detail rehydrates on focus
    } catch (e: any) {
      Alert.alert("Fulfill failed", e?.message || String(e));
    } finally {
      setPosting(false);
    }
  };

  if (!soId) return <Centered><Text>Missing soId</Text></Centered>;
  if (loading) return <Centered><ActivityIndicator /><Text style={{ marginTop: 8 }}>Loading SO…</Text></Centered>;
  if (!so) return <Centered><Text>Sales order not found</Text></Centered>;

  return (
    <KeyboardAvoidingScreen>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
        <Card title="Sales Fulfillment">
          <Row label="SO #" value={so.soNumber || so.id} />
          <Row label="Customer" value={so.customerName || so.customerId || "—"} />
          <Row label="Status" value={so.status} />
        </Card>

        <Collapsible title="Lines to Fulfill" defaultOpen>
          <View style={{ gap: 8 }}>
            {(so.lines || []).map((ln) => {
              const left = remaining[ln.id] ?? 0;
              const val = ff[ln.id]?.deltaQty ?? 0;
              return (
                <View key={ln.id} style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 12, padding: 12, gap: 8 }}>
                  <Text style={{ fontWeight: "600" }}>{ln.itemId}</Text>
                  <Text style={{ color: t.colors.textMuted }}>
                    Ordered {ln.qtyOrdered} • Committed {ln.qtyCommitted ?? 0} • Fulfilled {ln.qtyFulfilled ?? 0} • Remaining {left}
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
                      style={{ flex: 1, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                    />
                    <IconBtn onPress={() => bump(ln.id, +1)} icon="plus" />
                    <Pressable
                      onPress={() => setDelta(ln.id, left)}
                      style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8 }}
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
              onPress={fulfillAllRemaining}
              style={{ paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: t.colors.border, borderRadius: 10 }}
            >
              <Text>Fulfill All Remaining</Text>
            </Pressable>
          </View>
        </Collapsible>

        <Pressable
          onPress={post}
          disabled={posting}
          style={{ marginTop: 8, backgroundColor: posting ? t.colors.textMuted : t.colors.primary, paddingVertical: 14, borderRadius: 12, alignItems: "center" }}
        >
          {posting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Post Fulfillment</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

/* shared pieces */
function KeyboardAvoidingScreen({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={64}>
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
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 12, padding: 12, gap: 8, backgroundColor: t.colors.card }}>
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
function Collapsible({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const t = useColors();
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 12, backgroundColor: t.colors.card }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 }}>
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
    <Pressable onPress={onPress} style={{ padding: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8 }}>
      <Feather name={icon} size={16} color={t.colors.text} />
    </Pressable>
  );
}
