import * as React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useObjectsList } from "../features/_shared/useObjectsList";
import type { components } from "../api/generated-types";
type GoodsReceipt = components["schemas"]["GoodsReceipt"];

export default function GoodsReceiptsListScreen({ navigation }: any) {
  const t = useColors();
  const q = useObjectsList<GoodsReceipt>({ type: "goodsReceipt", limit: 20, by: "updatedAt", sort: "desc" });

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => {
    setPulling(true);
    try { await q.refetch(); } finally { setPulling(false); }
  }, [q]);
  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  const renderItem = ({ item }: { item: GoodsReceipt }) => {
    const id = String(item.id ?? "");
    const title =
      (item as any).name ??
      (item as any).number ??
      `Goods Receipt ${id.slice(0, 8)}`;

    const poId = (item as any)?.purchaseOrderId;
    const lineCount = Array.isArray((item as any)?.lines) ? (item as any).lines.length : 0;
    const parts: string[] = [];
    if (poId) parts.push(`PO: ${poId}`);
    if (lineCount) parts.push(`${lineCount} line${lineCount === 1 ? "" : "s"}`);
    const subtitle = parts.join(" • ") || "—";

    const status = String((item as any)?.status ?? "pending");

    return (
      <Pressable
        onPress={() => navigation.navigate("GoodsReceiptDetail", { id, mode: "edit" })}
        style={{
          backgroundColor: t.colors.card,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: 12,
          marginBottom: 10,
          padding: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16, flex: 1 }}>
            {title}
          </Text>
          <StatusPill value={status} />
        </View>
        <Text style={{ color: t.colors.muted, marginTop: 4 }}>{subtitle}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <FlatList
        data={q.items}
        keyExtractor={(i, idx) => String((i as any).id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            {q.isLoading ? (
              <ActivityIndicator />
            ) : q.isError ? (
              <Text style={{ color: t.colors.danger }}>
                Error: {String(q.error?.message ?? "unknown")}
              </Text>
            ) : (
              <Text style={{ color: t.colors.muted }}>
                No goods receipts yet. Receive a Purchase Order to generate one.
              </Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />
      {/* Intentionally no “+ New” — receipts are produced by receiving a PO */}
    </View>
  );
}

function StatusPill({ value }: { value: string }) {
  const t = useColors();
  const v = value?.toLowerCase?.() ?? "pending";
  const { bg, fg, br } = getStatusStyle(t, v);
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: br,
        marginLeft: 8,
      }}
    >
      <Text style={{ color: fg, fontWeight: "700", fontSize: 12 }}>{v}</Text>
    </View>
  );
}

function getStatusStyle(t: ReturnType<typeof useColors>, v: string) {
  // Map to your existing palette only
  // pending → received → closed → canceled
  if (v === "received" || v === "closed") {
    return { bg: t.colors.card, fg: t.colors.primary, br: t.colors.primary };
  }
  if (v === "canceled") {
    return { bg: t.colors.card, fg: t.colors.danger,  br: t.colors.danger  };
  }
  // default: pending/unknown
  return { bg: t.colors.card, fg: t.colors.text,    br: t.colors.border  };
}

