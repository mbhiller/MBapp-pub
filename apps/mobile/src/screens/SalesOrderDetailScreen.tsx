// apps/mobile/src/screens/SalesOrderDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, FlatList, Pressable, Alert, TextInput, Modal, ScrollView } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
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
import { ScannerPanel } from "../features/_shared/ScannerPanel";
import { resolveScan } from "../lib/scanResolve";
import { pickBestMatchingLineId, incrementCapped } from "../features/_shared/scanLineSelect";
import { apiClient } from "../api/client";
import { track, trackScreenView } from "../lib/telemetry";

export default function SalesOrderDetailScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading, refetch } = useObjects<any>({ type: "salesOrder", id });
  const toast = useToast();
  
  // Normalize Sales Order from useObjects response
  const so = (data as any)?.body ?? data ?? null;

  const [commitHint, setCommitHint] = React.useState<{ type: "success" | "error"; message: string } | null>(null);
  
  // Outbound location/lot defaults (foundation for future pick/pack/ship)
  const [defaultLocationId, setDefaultLocationId] = React.useState<string | null>(null);
  const [defaultLot, setDefaultLot] = React.useState<string>("");
  const [locationModalOpen, setLocationModalOpen] = React.useState(false);
  const [locationQuery, setLocationQuery] = React.useState("");
  const [locationOptions, setLocationOptions] = React.useState<any[]>([]);

  // Scan-to-fulfill mode: track pending fulfills keyed by lineId
  const [scanMode, setScanMode] = React.useState(false);
  const [scanInput, setScanInput] = React.useState("");
  const [pendingFulfills, setPendingFulfills] = React.useState<Map<string, number>>(new Map());
  const [scanHistory, setScanHistory] = React.useState<Array<{ lineId: string; itemId: string; delta: number }>>([])

  // Backorder status breakdown
  const [backorderBreakdown, setBackorderBreakdown] = React.useState<{ open: number; ignored: number; converted: number; fulfilled: number; total: number; totalQty: number }>({ open: 0, ignored: 0, converted: 0, fulfilled: 0, total: 0, totalQty: 0 });
  const [backorderBreakdownLoading, setBackorderBreakdownLoading] = React.useState(false);

  // Track screen view on focus
  useFocusEffect(
    React.useCallback(() => {
      if (id) {
        trackScreenView("SalesOrderDetail", { objectType: "salesOrder", objectId: id });
      }
    }, [id])
  );

  // Fetch backorder status breakdown
  const fetchBackorderBreakdown = React.useCallback(async () => {
    if (!id) return;
    setBackorderBreakdownLoading(true);
    try {
      const allBackorders: any[] = [];
      for (const status of ["open", "ignored", "converted", "fulfilled"]) {
        try {
          const res: any = await apiClient.post("/objects/backorderRequest/search", { soId: id, status });
          const items = res?.body?.items ?? res?.items ?? [];
          if (Array.isArray(items)) allBackorders.push(...items);
        } catch (err) {
          console.warn(`Failed to fetch backorders with status ${status}:`, err);
        }
      }
      
      const breakdown = {
        open: 0,
        ignored: 0,
        converted: 0,
        fulfilled: 0,
        total: 0,
        totalQty: 0,
      };
      for (const bo of allBackorders) {
        breakdown.total++;
        breakdown.totalQty += bo.qty ?? 0;
        const boStatus = (bo.status ?? "open") as keyof typeof breakdown;
        if (boStatus in breakdown && boStatus !== "total" && boStatus !== "totalQty") {
          breakdown[boStatus as Exclude<keyof typeof breakdown, "total" | "totalQty">]++;
        }
      }
      setBackorderBreakdown(breakdown);
    } catch (err) {
      console.error("Failed to fetch backorder breakdown:", err);
    } finally {
      setBackorderBreakdownLoading(false);
    }
  }, [id]);

  // Fetch backorder breakdown when component loads or soId changes
  React.useEffect(() => {
    if (id) {
      fetchBackorderBreakdown();
    }
  }, [id, fetchBackorderBreakdown]);

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
      return { 
        lineId, 
        deltaQty: reserveDelta,
        ...(defaultLocationId ? { locationId: defaultLocationId } : {}),
        ...(defaultLot ? { lot: defaultLot } : {})
      };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  const releasePayload = () => {
    const mapped = lines.map((line: any) => {
      const reserved = Number(line?.qtyReserved ?? 0);
      const lineId = String(line?.id ?? line?.lineId ?? "");
      return { 
        lineId, 
        deltaQty: reserved,
        ...(defaultLocationId ? { locationId: defaultLocationId } : {}),
        ...(defaultLot ? { lot: defaultLot } : {})
      };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  const fulfillPayload = () => {
    const mapped = lines.map((line: any) => {
      const ordered = Number(line?.qty ?? 0);
      const fulfilled = Number(line?.qtyFulfilled ?? 0);
      const reserved = Number(line?.qtyReserved ?? 0);
      const remaining = Math.max(0, ordered - fulfilled);
      
      // If qty is reserved, fulfill up to reserved amount (but not more than remaining)
      // If no reserve, fulfill the remaining to-ship qty (enables fulfill-without-reserve)
      const deltaQty = reserved > 0 ? Math.min(reserved, remaining) : Math.max(0, remaining);
      
      const lineId = String(line?.id ?? line?.lineId ?? "");
      return { 
        lineId, 
        deltaQty,
        ...(defaultLocationId ? { locationId: defaultLocationId } : {}),
        ...(defaultLot ? { lot: defaultLot } : {})
      };
    }).filter((l) => l.lineId && l.deltaQty > 0);
    return { lines: mapped };
  };

  // Scan-to-fulfill helpers (mirror PO receive logic)
  const findLinesForItem = (itemId: string) =>
    lines.filter((line: any) => String(line.itemId).toLowerCase() === String(itemId).toLowerCase());

  const getRemainingQtyToFulfill = (line: any) =>
    Math.max(0, Number(line.qty ?? 0) - Number(line.qtyFulfilled ?? 0));

  const onScanResult = async (scan: string) => {
    try {
      const result = await resolveScan(scan);
      if (!result.ok) {
        toast(`Scan not recognized: ${result.error.reason ?? "unknown"}`, "info");
        return;
      }

      const { itemId } = result.value;
      const lineId = pickBestMatchingLineId({
        lines,
        itemId,
        getLineId: (line: any) => String(line?.id ?? line?.lineId ?? ""),
        getLineItemId: (line: any) => (line?.itemId != null ? String(line.itemId) : undefined),
        getRemaining: (line: any) => Math.max(0, Number(line?.qty ?? 0) - Number(line?.qtyFulfilled ?? 0)),
      });
      if (!lineId) {
        toast(`No line found for item ${itemId}`, "info");
        return;
      }
      const targetLine = lines.find((ln: any) => String(ln?.id ?? ln?.lineId ?? "") === lineId);
      const remaining = targetLine ? getRemainingQtyToFulfill(targetLine) : 0;

      if (remaining <= 0) {
        toast(`Item ${itemId} is fully fulfilled`, "info");
        return;
      }

      const updated = incrementCapped(pendingFulfills, lineId, remaining, 1);
      setPendingFulfills(updated);

      setScanHistory((prev) => [
        ...prev,
        { lineId, itemId, delta: 1 },
      ]);

      setScanInput("");
      toast(`Added 1x ${itemId}`, "success");
    } catch (err: any) {
      console.error(err);
      toast(err?.message || "Scan resolution error", "error");
    }
  };

  // Helper: create stable idempotency key for a single submit attempt
  // Uses SMOKE_RUN_ID when present; falls back to a timestamp captured once.
  const makeScanIdempotencyKey = (soId: string, lineCount: number) => {
    const runToken =
      (typeof process !== "undefined" && (process as any)?.env?.EXPO_PUBLIC_SMOKE_RUN_ID) ||
      (typeof process !== "undefined" && (process as any)?.env?.SMOKE_RUN_ID) ||
      String(Date.now());
    return `so:${soId}#scan:${runToken}#lines:${lineCount}`;
  };

  const undoLastScan = () => {
    if (scanHistory.length === 0) return;
    const last = scanHistory[scanHistory.length - 1];
    const updated = new Map(pendingFulfills);
    const current = updated.get(last.lineId) ?? 0;
    if (current > 0) {
      updated.set(last.lineId, current - 1);
      setPendingFulfills(updated);
    }
    setScanHistory((prev) => prev.slice(0, -1));
    toast("Undid last scan", "info");
  };

  const clearPendingFulfills = () => {
    setPendingFulfills(new Map());
    setScanHistory([]);
    toast("Cleared pending fulfills", "info");
  };

  const submitPendingFulfills = async () => {
    if (pendingFulfills.size === 0) {
      toast("No pending fulfills", "info");
      return;
    }

    if (!id) {
      toast("SO not loaded", "error");
      return;
    }

    try {
      const linesToFulfill = Array.from(pendingFulfills.entries()).map(([lineId, deltaQty]) => ({
        lineId,
        deltaQty,
        ...(defaultLocationId ? { locationId: defaultLocationId } : {}),
        ...(defaultLot ? { lot: defaultLot } : {}),
      }));

      // Capture a stable idempotency key for this submit attempt
      const idempotencyKey = makeScanIdempotencyKey(id, linesToFulfill.length);

      await fulfillSalesOrder(id, linesToFulfill, { idempotencyKey });
      toast(`Fulfilled ${linesToFulfill.length} line(s)`, "success");
      setPendingFulfills(new Map());
      setScanHistory([]);
      setScanMode(false);
      await refetch();
      await fetchBackorderBreakdown();
      await refetchAvailability();
    } catch (err: any) {
      console.error(err);
      toast(err?.message || "Submit failed", "error");
    }
  };

  async function run(label: string, fn: () => Promise<any>) {
    if (!id) return;

    // Track attempt for commit actions
    const isCommit = label === "Commit" || label === "Commit (strict)";
    const strict = label === "Commit (strict)";
    if (isCommit) {
      track("SO_Commit_Clicked", {
        objectType: "salesOrder",
        objectId: id,
        strict,
        result: "attempt",
      });
    }

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

      // Track success for commit actions
      if (isCommit) {
        track("SO_Commit_Clicked", {
          objectType: "salesOrder",
          objectId: id,
          strict,
          result: "success",
        });
      }

      await refetch();
      await fetchBackorderBreakdown();
      await refetchAvailability();
    } catch (e: any) {
      console.error(e);

      // Track failure for commit actions
      if (isCommit) {
        const errorCode = e?.code ?? e?.status ?? "UNKNOWN_ERROR";
        track("SO_Commit_Clicked", {
          objectType: "salesOrder",
          objectId: id,
          strict,
          result: "fail",
          errorCode,
        });

        // Capture exception in Sentry (dynamic require)
        try {
          const Sentry = require("@sentry/react-native");
          Sentry.captureException(e, {
            tags: {
              objectType: "salesOrder",
              objectId: id,
              action: "commit",
            },
          });
        } catch {
          // Sentry not available
        }
      }

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
        {backorders.length > 0 || backorderBreakdown.total > 0 ? (
          <Pressable onPress={() => so?.id ? nav.navigate("BackordersList", { soId: so.id }) : nav.navigate("BackordersList")}>
            <BackorderHeaderBadge count={backorders.length} breakdown={backorderBreakdown} />
          </Pressable>
        ) : (
          <BackorderHeaderBadge count={backorders.length} breakdown={backorderBreakdown} />
        )}
      </View>

      {/* Outbound defaults: location + lot (foundation) */}
      <View style={{ marginBottom: 10, padding: 10, borderRadius: 8, backgroundColor: "#f5f5f5", borderWidth: 1, borderColor: "#ddd" }}>
        <Text style={{ fontWeight: "600", marginBottom: 8 }}>Outbound Defaults</Text>
        
        {/* Location selector */}
        <View style={{ marginBottom: 8 }}>
          <Pressable
            onPress={() => setLocationModalOpen(true)}
            style={{ 
              padding: 10, 
              borderRadius: 6, 
              borderWidth: 1, 
              borderColor: "#ccc", 
              backgroundColor: "#fff",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <Text style={{ color: defaultLocationId ? "#000" : "#999" }}>
              {defaultLocationId ? `Location: ${defaultLocationId}` : "Select location (optional)"}
            </Text>
            <Text style={{ fontSize: 12, color: "#666" }}>▼</Text>
          </Pressable>
        </View>

        {/* Lot input */}
        <View>
          <TextInput
            placeholder="Lot (optional)"
            value={defaultLot}
            onChangeText={setDefaultLot}
            style={{ 
              padding: 10, 
              borderRadius: 6, 
              borderWidth: 1, 
              borderColor: "#ccc", 
              backgroundColor: "#fff"
            }}
          />
        </View>
      </View>

      {/* Location picker modal */}
      <Modal visible={locationModalOpen} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 12, width: "100%", maxHeight: "80%", padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", marginBottom: 12 }}>Select Location</Text>
            <TextInput
              placeholder="Search locations..."
              value={locationQuery}
              onChangeText={setLocationQuery}
              style={{ 
                padding: 10, 
                borderRadius: 6, 
                borderWidth: 1, 
                borderColor: "#ccc", 
                marginBottom: 12,
                backgroundColor: "#f9f9f9"
              }}
            />
            <ScrollView style={{ marginBottom: 12 }}>
              {/* Placeholder: in real implementation, fetch locations from API and filter by locationQuery */}
              {defaultLocationId && (
                <Pressable
                  onPress={() => {
                    setLocationModalOpen(false);
                    setLocationQuery("");
                  }}
                  style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: "#eee" }}
                >
                  <Text style={{ color: "#000", fontWeight: "600" }}>{defaultLocationId}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  setDefaultLocationId(null);
                  setLocationModalOpen(false);
                  setLocationQuery("");
                }}
                style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: "#eee" }}
              >
                <Text style={{ color: "#666" }}>Clear selection</Text>
              </Pressable>
            </ScrollView>
            <Pressable
              onPress={() => {
                setLocationModalOpen(false);
                setLocationQuery("");
              }}
              style={{ 
                padding: 12, 
                borderRadius: 6, 
                backgroundColor: "#666",
                alignItems: "center"
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

      {/* Scan-to-Fulfill Mode */}
      {canFulfill && (
        <View style={{ marginTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: "#ccc", paddingTop: 12 }}>
          {!scanMode ? (
            <Pressable
              onPress={() => setScanMode(true)}
              style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, backgroundColor: "#f5f5f5" }}
            >
              <Text>Scan to Fulfill</Text>
            </Pressable>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ fontWeight: "700" }}>Scan to Fulfill</Text>

              {/* Scanner panel */}
              <ScannerPanel
                value={scanInput}
                onChange={(raw) => {
                  setScanInput(raw);
                  if (raw.trim()) onScanResult(raw);
                }}
              />

              {/* Pending fulfills list */}
              {pendingFulfills.size > 0 && (
                <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#e0e0e0" }}>
                  <Text style={{ fontWeight: "600", marginBottom: 8 }}>
                    Pending Fulfills ({pendingFulfills.size})
                  </Text>
                  <ScrollView style={{ maxHeight: 200 }}>
                    {Array.from(pendingFulfills.entries()).map(([lineId, delta]) => {
                      const line = lines.find(
                        (l: any) => String(l.id ?? l.lineId) === lineId
                      );
                      if (!line) return null;
                      const ordered = Number(line.qty ?? 0);
                      const fulfilled = Number(line.qtyFulfilled ?? 0);
                      const remaining = ordered - fulfilled;
                      return (
                        <View
                          key={lineId}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            paddingVertical: 6,
                            paddingHorizontal: 8,
                            backgroundColor: "#f5f5f5",
                            borderRadius: 6,
                            marginBottom: 6,
                            gap: 8,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
                            <Text style={{ fontSize: 12, color: "#666" }}>
                              {ordered} ordered, {fulfilled} fulfilled, {remaining} remaining
                            </Text>
                            <Text style={{ fontSize: 12, fontWeight: "600", color: "#2196F3" }}>
                              +{delta} pending
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Actions */}
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {scanHistory.length > 0 && (
                  <Pressable
                    onPress={undoLastScan}
                    style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, backgroundColor: "#fff3cd" }}
                  >
                    <Text>Undo Last</Text>
                  </Pressable>
                )}
                {pendingFulfills.size > 0 && (
                  <Pressable
                    onPress={clearPendingFulfills}
                    style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, backgroundColor: "#f8d7da" }}
                  >
                    <Text>Clear All</Text>
                  </Pressable>
                )}
                {pendingFulfills.size > 0 && (
                  <Pressable
                    onPress={submitPendingFulfills}
                    style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, backgroundColor: "#d4edda" }}
                  >
                    <Text>Submit {pendingFulfills.size} line(s)</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setScanMode(false)}
                  style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, backgroundColor: "#e2e3e5" }}
                >
                  <Text>Cancel</Text>
                </Pressable>
              </View>
            </View>
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
            return run("Fulfill", () => fulfillSalesOrder(id!, payload.lines));
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
