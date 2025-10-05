// apps/mobile/src/features/inventory/StockCard.tsx
import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useColors } from "../_shared/useColors";
import { useStock } from "./useStock";

export default function StockCard({ itemId }: { itemId?: string }) {
  const t = useColors();
  const { onhand, movements } = useStock(itemId);

  const recent = (movements.data ?? []).slice(0, 5);

  return (
    <View
      style={{
        backgroundColor: t.colors.card,
        borderColor: t.colors.border,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        marginTop: 12,
      }}
    >
      <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>Stock</Text>

      {onhand.isLoading ? (
        <View style={{ paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ color: t.colors.muted }}>Loading stock…</Text>
        </View>
      ) : onhand.error ? (
        <Text style={{ color: t.colors.danger }}>
          {(onhand.error as any)?.message || "Failed to load stock"}
        </Text>
      ) : (
        <RowNumbers
          label1="On-hand"
          value1={onhand.data?.onHand}
          label2="Reserved"
          value2={onhand.data?.reserved}
          label3="Available"
          value3={onhand.data?.available}
        />
      )}

      {/* Recent movements (rendered non-virtualized to avoid nested VirtualizedList warning) */}
      {movements.isLoading ? null : recent.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: t.colors.muted, marginBottom: 6 }}>Recent movements</Text>
          <View>
            {recent.map((item, i) => (
              <View key={String(item.id ?? i)} style={{ paddingVertical: 8 }}>
                {i > 0 ? <View style={{ height: 1, backgroundColor: t.colors.border, marginBottom: 8 }} /> : null}
                <MovementRow item={item} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RowNumbers(props: {
  label1: string; value1?: number;
  label2?: string; value2?: number;
  label3?: string; value3?: number;
}) {
  const t = useColors();
  const cell = (label: string, val?: number) => (
    <View style={{ flex: 1, paddingVertical: 6 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 4 }}>{label}</Text>
      <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 18 }}>{val != null ? String(val) : "—"}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      {cell(props.label1, props.value1)}
      {props.label2 ? cell(props.label2, props.value2) : null}
      {props.label3 ? cell(props.label3, props.value3) : null}
    </View>
  );
}

function MovementRow({
  item,
}: {
  item: { ts?: string; kind?: string; delta?: number; refType?: string; refId?: string; note?: string };
}) {
  const t = useColors();
  const when = item.ts ? new Date(item.ts).toLocaleString() : "";
  const meta = [item.refType, item.refId].filter(Boolean).join("/");
  const sign = item.delta != null && item.delta >= 0 ? "+" : "";
  return (
    <View>
      <Text style={{ color: t.colors.text, fontWeight: "600" }}>
        {item.kind || "movement"} {sign}
        {item.delta ?? 0}
      </Text>
      <Text style={{ color: t.colors.muted, fontSize: 12 }}>
        {when}
        {meta ? ` • ${meta}` : ""}
        {item.note ? ` • ${item.note}` : ""}
      </Text>
    </View>
  );
}
