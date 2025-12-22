// apps/mobile/src/screens/SalesOrderDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, FlatList, Pressable, Alert } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
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
  const nav = useNavigation<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading, refetch } = useObjects<any>({ type: "salesOrder", id });
  const toast = (useToast?.() as any) ?? ((msg: string) => console.log("TOAST:", msg));

  const [commitHint, setCommitHint] = React.useState<{ type: "success" | "error"; message: string } | null>(null);

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
      const ordered = Number(line?.qty ?? 0);
      const fulfilled = Number(line?.qtyFulfilled ?? 0);
      const reserved = Number(line?.qtyReserved ?? 0);
      const remainingToShip = Math.max(0, ordered - fulfilled);
      const reserveDelta = Math.max(0, remainingToShip - reserved);
      const lineId = String(line?.id ?? line?.lineId ?? "");
      return { lineId, deltaQty: reserveDelta };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  const releasePayload = () => {
    const mapped = lines.map((line: any) => {
      const reserved = Number(line?.qtyReserved ?? 0);
      const lineId = String(line?.id ?? line?.lineId ?? "");
      return { lineId, deltaQty: reserved };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  const fulfillPayload = () => {
    const mapped = lines.map((line: any) => {
      const reserved = Number(line?.qtyReserved ?? 0);
      const lineId = String(line?.id ?? line?.lineId ?? "");
      return { lineId, deltaQty: Math.max(0, reserved) };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  async function run(label: string, fn: () => Promise<any>) {
    if (!id) return;
    try {
      await fn();
      if (label === "Commit") {
        toast("Committed. Any shortages will be tracked as Backorders.", "success");
        setCommitHint({ type: "success", message: "Shortages tracked as Backorders." });
      } else if (label === "Commit (strict)") {
        toast(`${label} ok`, "success");
        setCommitHint(null);
      } else {
        toast(`${label} ok`, "success");
      }
      await refetch();
    } catch (e: any) {
      console.error(e);
      if (e?.status === 409) {
        // User-friendly 409 messages
        if (label === "Commit (strict)") {
          toast("Shortages detected. Strict commit blocked.", "warning");
          setCommitHint({ type: "error", message: "Try non-strict commit to create backorders." });
        } else if (label === "Commit") {
          toast("Insufficient availability to commit.", "warning");
          setCommitHint(null);
        } else if (label === "Reserve") {
          toast(e?.message || "Insufficient availability to reserve.", "warning");
        } else if (label === "Release") {
          toast(e?.message || "Cannot release: inventory conflict.", "warning");
        } else if (label === "Fulfill") {
          toast(e?.message || "Insufficient availability to fulfill.", "warning");
        } else if (label === "Cancel") {
          toast(e?.message || "Cannot cancel with reservations or fulfillments.", "warning");
        } else if (label === "Close") {
          toast(e?.message || "Cannot close unless order is fulfilled.", "warning");
        } else {
          toast(e?.message || `${label} failed (conflict)`, "warning");
        }
      } else if (e?.status === 500) {
        // Handle server errors
        if (label === "Close") {
          toast("Close failed (server error). Try again after refresh.", "error");
        } else {
          toast(e?.message || `${label} failed`, "error");
        }
        setCommitHint(null);
      } else {
        toast(e?.message || `${label} failed`, "error");
        setCommitHint(null);
      }
    }
  }

  const hasReservations = lines.some((line: any) => Number(line?.qtyReserved ?? 0) > 0);
  const hasFulfillments = lines.some((line: any) => Number(line?.qtyFulfilled ?? 0) > 0);
  const isCancelled = ["canceled", "cancelled"].includes(so?.status);
  const isClosed = so?.status === "closed";

  const canSubmit = so?.status === "draft";
  const canCommit = ["submitted"].includes(so?.status);
  const canReserve = ["submitted", "committed", "partially_fulfilled"].includes(so?.status);
  const canRelease = ["submitted", "committed", "partially_fulfilled"].includes(so?.status);
  const canFulfill = ["submitted", "committed", "partially_fulfilled"].includes(so?.status);
  const canCancel = !(hasReservations || hasFulfillments || isCancelled || isClosed);
  const canClose = !(isCancelled || isClosed);

  if (isLoading) return <ActivityIndicator />;

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Sales Order {so?.id}</Text>
      <Text>Status: {so?.status}</Text>
      <BackorderHeaderBadge count={backorders.length} />


      {/* Commit hint (success or error) */}
      {commitHint && (
        <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: commitHint.type === "success" ? "#e8f5e9" : "#fff3e0", borderLeftWidth: 4, borderLeftColor: commitHint.type === "success" ? "#4caf50" : "#ff9800" }}>
          <Text style={{ fontSize: 13, marginBottom: 6, color: commitHint.type === "success" ? "#2e7d32" : "#e65100" }}>{commitHint.message}</Text>
          {commitHint.type === "success" && (
            <Pressable onPress={() => { setCommitHint(null); nav.navigate("BackordersList"); }} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#4caf50", borderRadius: 4, alignSelf: "flex-start" }}>
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>View Backorders</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable disabled={!canSubmit} onPress={() => run("Submit", () => submitSalesOrder(id!))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canSubmit ? 0.5 : 1 }}>
          <Text>Submit</Text>
        </Pressable>
        <Pressable disabled={!canCommit} onPress={() => run("Commit", () => commitSalesOrder(id!, { strict: false }))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canCommit ? 0.5 : 1 }}>
          <Text>Commit</Text>
        </Pressable>
        <Pressable disabled={!canCommit} onPress={() => run("Commit (strict)", () => commitSalesOrder(id!, { strict: true }))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canCommit ? 0.5 : 1 }}>
          <Text>Commit (strict)</Text>
        </Pressable>
        <Pressable
          disabled={!canReserve}
          onPress={() => {
            const payload = reservePayload();
            if (!payload.lines.length) { toast("Nothing to reserve", "info"); return; }
            return run("Reserve", () => reserveSalesOrder(id!, payload));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canReserve ? 0.5 : 1 }}
        >
          <Text>Reserve remaining</Text>
        </Pressable>
        <Pressable
          disabled={!canRelease}
          onPress={() => {
            const payload = releasePayload();
            if (!payload.lines.length) { toast("Nothing to release", "info"); return; }
            return run("Release", () => releaseSalesOrder(id!, payload));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canRelease ? 0.5 : 1 }}
        >
          <Text>Release all reserved</Text>
        </Pressable>
        <Pressable
          disabled={!canFulfill}
          onPress={() => {
            const payload = fulfillPayload();
            if (!payload.lines.length) { toast("Nothing to fulfill", "info"); return; }
            return run("Fulfill", () => fulfillSalesOrder(id!, payload));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canFulfill ? 0.5 : 1 }}
        >
          <Text>Fulfill remaining</Text>
        </Pressable>
        <Pressable disabled={!canCancel} onPress={() => {
          Alert.alert("Cancel Order?", "This action cannot be undone.", [
            { text: "No", onPress: () => {}, style: "cancel" },
            { text: "Yes, Cancel", onPress: () => run("Cancel", () => cancelSalesOrder(id!)), style: "destructive" }
          ]);
        }} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canCancel ? 0.5 : 1 }}>
          <Text>Cancel</Text>
        </Pressable>
        <Pressable disabled={!canClose} onPress={() => {
          Alert.alert("Close Order?", "This action cannot be undone.", [
            { text: "No", onPress: () => {}, style: "cancel" },
            { text: "Yes, Close", onPress: () => run("Close", () => closeSalesOrder(id!)), style: "destructive" }
          ]);
        }} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: !canClose ? 0.5 : 1 }}>
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
