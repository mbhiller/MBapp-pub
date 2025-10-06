import * as React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useObjectsList } from "../features/_shared/useObjectsList";
import type { components } from "../api/generated-types";
type PurchaseOrder = components["schemas"]["PurchaseOrder"];

export default function PurchaseOrdersListScreen({ navigation }: any) {
  const t = useColors();
  const q = useObjectsList<PurchaseOrder>({ type: "purchaseOrder", limit: 20, by: "updatedAt", sort: "desc" });

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => {
    setPulling(true);
    try { await q.refetch(); } finally { setPulling(false); }
  }, [q]);
  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  const renderItem = ({ item }: { item: PurchaseOrder }) => {
    const id = String(item.id ?? "");
    const title =
      (item as any).name ??
      (item as any).number ??
      (item as any).vendorName ??
      `Purchase Order ${id.slice(0, 8)}`;

    const lineCount = Array.isArray((item as any).lines) ? (item as any).lines.length : 0;
    const parts: string[] = [];
    if ((item as any).vendorName) parts.push(String((item as any).vendorName));
    if (lineCount) parts.push(`${lineCount} line${lineCount === 1 ? "" : "s"}`);
    const subtitle = parts.join(" • ") || "—";

    const status = String((item as any).status ?? "draft");

    return (
      <Pressable
        onPress={() => navigation.navigate("PurchaseOrderDetail", { id, mode: "edit" })}
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
              <Text style={{ color: t.colors.muted }}>No purchase orders.</Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />

      {/* + New */}
      <Pressable
        onPress={() => navigation.navigate("PurchaseOrderDetail" /* or detail new? */, { mode: "new" })}
        // If you want to go straight to detail like other modules:
        // onPress={() => navigation.navigate("PurchaseOrderDetail", { mode: "new" })}
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          backgroundColor: t.colors.primary,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}

function StatusPill({ value }: { value: string }) {
  const t = useColors();
  const v = value?.toLowerCase?.() ?? "draft";
  const { bg, fg, br } = getPOStatusStyle(t, v);
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

function getPOStatusStyle(t: ReturnType<typeof useColors>, v?: string) {
  const s = String(v || "").toLowerCase();
  // happy/positive
  if (["approved", "receiving", "received", "closed"].includes(s)) {
    return { bg: t.colors.card, fg: t.colors.primary, br: t.colors.primary };
  }
  // negative
  if (s === "canceled" || s === "cancelled" || s === "rejected") {
    return { bg: t.colors.card, fg: t.colors.danger,  br: t.colors.danger  };
  }
  // neutral (draft/submitted/unknown)
  return { bg: t.colors.card, fg: t.colors.text,    br: t.colors.border  };
}

