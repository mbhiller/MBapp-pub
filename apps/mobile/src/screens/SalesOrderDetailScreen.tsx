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
import { copyText } from "../features/_shared/copy";
import { useSalesOrderAvailability } from "../features/salesOrders/useAvailabilityBatch";

export default function SalesOrderDetailScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading, refetch } = useObjects<any>({ type: "salesOrder", id });
  const toast = useToast();

  const [commitHint, setCommitHint] = React.useState<{ type: "success" | "error"; message: string } | null>(null);

  const so = data;
  const lines = (so?.lines ?? []) as any[];
  const backorders = (so?.backorders ?? []) as any[];

  const itemIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const l of lines) {
      const itemId = l?.itemId;
      if (itemId) ids.add(String(itemId));
    }
    return Array.from(ids);
  }, [lines]);

  const { availabilityMap, isLoading: isAvailabilityLoading, refetch: refetchAvailability } = useSalesOrderAvailability(itemIds);

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
      await refetchAvailability();
    } catch (e: any) {
      console.error(e);
      if (e?.status === 409) {
        // Parse shortages for actionable feedback (reserve/commit)
        const getBody = (): any => {
          const b = e?.body ?? e?.response?.data ?? e;
          if (typeof b === "string") { try { return JSON.parse(b); } catch { return {}; } }
          return b || {};
        };
        const body = getBody();
        const srcShortages: any[] = Array.isArray(body?.shortages) ? body.shortages : [];
        const normalized = srcShortages.map((s) => {
          const itemId = String(s?.itemId ?? "");
          const need = Number(s?.requested ?? s?.backordered ?? 0);
          const availFromPayload = s?.available != null ? Number(s.available) : undefined;
          const availFromMap = availabilityMap?.[itemId]?.available;
          const avail = availFromPayload != null ? availFromPayload : (Number.isFinite(availFromMap as any) ? (availFromMap as number) : undefined);
          return { itemId, need, avail };
        }).filter((x) => x.itemId && x.need > 0);

        if (normalized.length > 0 && (label === "Reserve" || label.startsWith("Commit"))) {
          const top = normalized.slice(0, 3);
          const more = normalized.length - top.length;
          const lines = top.map((x) => `Item ${x.itemId} need ${x.need} avail ${x.avail ?? "?"}`);
          const message = `${lines.join("\n")}${more > 0 ? `\n+${more} more` : ""}`;
          Alert.alert("Shortages detected", message);
          if (label === "Commit (strict)") {
            setCommitHint({ type: "error", message: "Strict commit blocked by shortages." });
          } else if (label === "Commit") {
            setCommitHint(null);
          }
        } else {
          // Fallback generic messages
          if (label === "Commit (strict)") {
            toast("Shortages detected. Strict commit blocked.", "warning");
            setCommitHint({ type: "error", message: "Try non-strict commit to create backorders." });
          } else if (label === "Commit") {
            toast("Insufficient availability to commit.", "warning");
            setCommitHint(null);
          } else if (label === "Reserve") {
            toast(body?.message || "Insufficient availability to reserve.", "warning");
          } else if (label === "Release") {
            toast(body?.message || "Cannot release: inventory conflict.", "warning");
          } else if (label === "Fulfill") {
            toast(body?.message || "Insufficient availability to fulfill.", "warning");
          } else if (label === "Cancel") {
            toast(body?.message || "Cannot cancel with reservations or fulfillments.", "warning");
          } else if (label === "Close") {
            toast(body?.message || "Cannot close unless order is fulfilled.", "warning");
          } else {
            toast(body?.message || `${label} failed (conflict)`, "warning");
          }
        }
        // Always refresh availability after a 409 so pills reflect current state
        await refetchAvailability();
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
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: "#000" }}>Sales Order </Text>
        <Pressable
          onLongPress={async () => {
            if (so?.id) {
              await copyText(String(so.id));
              toast("Copied", "success");
            }
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700" }}>{so?.id}</Text>
        </Pressable>
      </View>
      <Text>Status: {so?.status}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {backorders.length > 0 ? (
          <Pressable onPress={() => so?.id ? nav.navigate("BackordersList", { soId: so.id }) : nav.navigate("BackordersList")}>
            <BackorderHeaderBadge count={backorders.length} />
          </Pressable>
        ) : (
          <BackorderHeaderBadge count={backorders.length} />
        )}
      </View>

      {/* Commit hint (success or error) — only show "View Backorders" in hint when it's not already in header */}
      {commitHint && (
        <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: commitHint.type === "success" ? "#e8f5e9" : "#fff3e0", borderLeftWidth: 4, borderLeftColor: commitHint.type === "success" ? "#4caf50" : "#ff9800" }}>
          <Text style={{ fontSize: 13, marginBottom: 6, color: commitHint.type === "success" ? "#2e7d32" : "#e65100" }}>{commitHint.message}</Text>
          {commitHint.type === "success" && backorders.length === 0 && (
            <Pressable onPress={() => { setCommitHint(null); so?.id ? nav.navigate("BackordersList", { soId: so.id }) : nav.navigate("BackordersList"); }} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#4caf50", borderRadius: 4, alignSelf: "flex-start" }}>
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
        renderItem={({ item: line }: any) => {
          const backorderQty = (line as any)?.backordered ?? boMap[String(line.id ?? "")];
          const canNavigateToBackorders = backorderQty > 0 && so?.id && line.itemId;
          return (
            <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
              <Text>Qty: {line.qty} {line.uom || "ea"}</Text>
              {(() => {
                const availability = availabilityMap[String(line.itemId ?? "")];
                const onHand = Number.isFinite(availability?.onHand) ? availability?.onHand : undefined;
                const reserved = Number.isFinite(availability?.reserved) ? availability?.reserved : undefined;
                const available = Number.isFinite(availability?.available)
                  ? availability?.available
                  : (onHand != null && reserved != null ? onHand - reserved : undefined);
                if (!line?.itemId) {
                  return <Text style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Avail: —</Text>;
                }
                if (!availability) {
                  return <Text style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Avail: {isAvailabilityLoading ? "…" : "—"}</Text>;
                }
                return (
                  <Text style={{ color: "#555", fontSize: 12, marginTop: 4 }}>
                    Avail: {available ?? "?"} (OnHand {onHand ?? "?"}, Res {reserved ?? "?"})
                  </Text>
                );
              })()}
              <BackorderLineBadge qty={backorderQty} onPress={canNavigateToBackorders ? () => nav.navigate("BackordersList", { soId: so.id, itemId: line.itemId }) : undefined} />
            </View>
          );
        }}
      />
    </View>
  );
}
