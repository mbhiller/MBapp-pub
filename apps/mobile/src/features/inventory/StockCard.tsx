// apps/mobile/src/features/inventory/StockCard.tsx
import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useColors } from "../_shared/useColors";
import { useStock } from "./useStock";

export default function StockCard({ itemId }: { itemId?: string }) {
  const t = useColors();
  const { onhand, movements } = useStock(itemId);
  const mvItems = Array.isArray(movements.data)
    ? movements.data
    : Array.isArray((movements.data as any)?.items)
    ? (movements.data as any).items
    : [];
  const recent = mvItems.slice(0, 5);

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
          <Text style={{ color: t.colors.muted, marginBottom: 6 }}>Recent movements ({mvItems.length})</Text>
          <View>
            {recent.map((item: any, i: number) => (
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
  item: { 
    ts?: string; 
    at?: string;
    kind?: string; 
    action?: string;
    delta?: number;
    qty?: number;
    deltaQty?: number;
    refType?: string; 
    refId?: string;
    poLineId?: string;
    soLineId?: string;
    note?: string;
  };
}) {
  const t = useColors();
  
  // Action label: capitalize first letter of action or kind
  const actionRaw = item.action || item.kind || "Movement";
  const actionLabel = actionRaw.charAt(0).toUpperCase() + actionRaw.slice(1);
  
  // Quantity: prefer qty > deltaQty > 0
  const qtyValue = item.qty !== undefined ? item.qty : (item.deltaQty !== undefined ? item.deltaQty : 0);
  
  // Signed quantity based on action
  const actionLower = actionRaw.toLowerCase();
  let signedQty = "";
  if (actionLower === "receive" || actionLower === "adjust") {
    signedQty = `+${qtyValue}`;
  } else if (actionLower === "reserve" || actionLower === "fulfill") {
    signedQty = `-${qtyValue}`;
  } else {
    signedQty = String(qtyValue);
  }
  
  // Timestamp: use at field
  const when = item.at ? new Date(item.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  
  // Reference line with smart formatting
  let refText = "";
  if (item.refId) {
    if (item.poLineId) {
      refText = `PO: ${item.refId} · Line: ${item.poLineId}`;
    } else if (item.soLineId) {
      refText = `SO: ${item.refId} · Line: ${item.soLineId}`;
    } else {
      refText = `Ref: ${item.refId}`;
    }
  }
  
  return (
    <View>
      <Text style={{ color: t.colors.text, fontWeight: "600" }}>
        {actionLabel} {signedQty}
      </Text>
      <Text style={{ color: t.colors.muted, fontSize: 12 }}>
        {when}
      </Text>
      {refText ? (
        <Text style={{ color: t.colors.muted, fontSize: 12, marginTop: 2 }}>
          {refText}
        </Text>
      ) : null}
    </View>
  );
}
