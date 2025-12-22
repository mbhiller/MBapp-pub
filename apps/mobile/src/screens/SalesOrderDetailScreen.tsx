// apps/mobile/src/screens/SalesOrderDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, FlatList, Pressable } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { BackorderHeaderBadge, BackorderLineBadge } from "../features/backorders/BackorderBadges";
import {
  submitSalesOrder,
  commitSalesOrder,
  reserveSalesOrder,
  releaseSalesOrder,
  fulfillSalesOrder,
  cancelSalesOrder,
  closeSalesOrder,
} from "../features/sales/api";
import { useToast } from "../features/_shared/Toast";

export default function SalesOrderDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading, refetch } = useObjects<any>({ type: "salesOrder", id });
  const toast = (useToast?.() as any) ?? ((msg: string) => console.log("TOAST:", msg));

  const so = data;
  const lines = (so?.lines ?? []) as any[];
  const backorders = (so?.backorders ?? []) as any[];

  // Build line -> backordered map if needed
  const boMap: Record<string, number> = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const bo of backorders) {
      const lid = String(bo?.soLineId ?? "");
      const qty = Number(bo?.qty ?? 0);
      if (!lid || qty <= 0) continue;
      m[lid] = (m[lid] ?? 0) + qty;
    }
    return m;
  }, [JSON.stringify(backorders)]);

  const reservePayload = () => {
    const mapped = lines.map((line: any) => {
      const qty = Number(line?.qty ?? 0);
      const fulfilled = Number(line?.qtyFulfilled ?? 0);
      const deltaQty = Math.max(0, qty - fulfilled);
      return { lineId: line?.id, deltaQty };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  const releasePayload = () => {
    const mapped = lines.map((line: any) => {
      const qty = Number(line?.qty ?? 0);
      const fulfilled = Number(line?.qtyFulfilled ?? 0);
      const deltaQty = Math.max(0, qty - fulfilled);
      return { lineId: line?.id, deltaQty };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  const fulfillPayload = () => {
    const mapped = lines.map((line: any) => {
      const qty = Number(line?.qty ?? 0);
      const fulfilled = Number(line?.qtyFulfilled ?? 0);
      const deltaQty = Math.max(0, qty - fulfilled);
      return { lineId: line?.id, deltaQty };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  async function run(label: string, fn: () => Promise<any>) {
    if (!id) return;
    try {
      await fn();
      toast(`${label} ok`, "success");
      await refetch();
    } catch (e: any) {
      console.error(e);
      toast(e?.message || `${label} failed`, "error");
    }
  }

  if (isLoading) return <ActivityIndicator />;

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Sales Order {so?.id}</Text>
      <Text>Status: {so?.status}</Text>
      <BackorderHeaderBadge count={backorders.length} />

      {/* Actions */}
      <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable onPress={() => run("Submit", () => submitSalesOrder(id!))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}>
          <Text>Submit</Text>
        </Pressable>
        <Pressable onPress={() => run("Commit", () => commitSalesOrder(id!, { strict: false }))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}>
          <Text>Commit</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const payload = reservePayload();
            if (!payload.lines.length) { toast("Nothing to reserve", "info"); return; }
            return run("Reserve", () => reserveSalesOrder(id!, payload));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}
        >
          <Text>Reserve remaining</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const payload = releasePayload();
            if (!payload.lines.length) { toast("Nothing to release", "info"); return; }
            return run("Release", () => releaseSalesOrder(id!, payload));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}
        >
          <Text>Release all reserved</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const payload = fulfillPayload();
            if (!payload.lines.length) { toast("Nothing to fulfill", "info"); return; }
            return run("Fulfill", () => fulfillSalesOrder(id!, payload));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}
        >
          <Text>Fulfill remaining</Text>
        </Pressable>
        <Pressable onPress={() => run("Cancel", () => cancelSalesOrder(id!))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}>
          <Text>Cancel</Text>
        </Pressable>
        <Pressable onPress={() => run("Close", () => closeSalesOrder(id!))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}>
          <Text>Close</Text>
        </Pressable>
      </View>

      <FlatList
        style={{ marginTop: 12 }}
        data={lines}
        keyExtractor={(l: any) => String(l.id ?? l.itemId)}
        renderItem={({ item: line }: any) => (
          <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
            <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
            <Text>Qty: {line.qty} {line.uom || "ea"}</Text>
            <BackorderLineBadge qty={(line as any)?.backordered ?? boMap[String(line.id ?? "")]} />
          </View>
        )}
      />
    </View>
  );
}
