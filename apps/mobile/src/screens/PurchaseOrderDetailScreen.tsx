import * as React from "react";
import { View, Text, ActivityIndicator, FlatList, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { FEATURE_PO_QUICK_RECEIVE } from "../features/_shared/flags";
import { saveFromSuggestion, receiveLine, receiveLines, submit, approve, cancel, close } from "../features/purchasing/poActions";
import { useToast } from "../features/_shared/Toast";
import { copyText } from "../features/_shared/copy";
import { ReceiveHistorySheet } from "../features/purchasing/ReceiveHistorySheet";
import { VendorGuardBanner } from "../features/_shared/VendorGuardBanner";
import PartySelectorModal from "../features/parties/PartySelectorModal";
import { updateObject } from "../api/client";
import { useTheme } from "../providers/ThemeProvider";
import { ScannerPanel } from "../features/_shared/ScannerPanel";
import { resolveScan } from "../lib/scanResolve";
import { pickBestMatchingLineId, incrementCapped } from "../features/_shared/scanLineSelect";
import { track, trackScreenView } from "../lib/telemetry";

export default function PurchaseOrderDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string | undefined;

  const { data, isLoading, refetch } = useObjects<any>({ type: "purchaseOrder", id });
  const po = data;
  const { data: vendorParty } = useObjects<any>({ type: "party", id: po?.vendorId });
  const lines = (po?.lines ?? []) as any[];
  const toast = useToast();

  const [modal, setModal] = React.useState<{ open: boolean; lineId?: string; itemId?: string }>({ open: false });
  const [qty, setQty] = React.useState<string>("1");
  const [lot, setLot] = React.useState<string>("");
  const [locationId, setLocationId] = React.useState<string>("");
  // Order-level defaults for quick receive
  const [defaultLot, setDefaultLot] = React.useState<string>("");
  const [defaultLocationId, setDefaultLocationId] = React.useState<string>("");

  const [history, setHistory] = React.useState<{ open: boolean; itemId?: string; lineId?: string }>({ open: false });
  const [vendorModalOpen, setVendorModalOpen] = React.useState(false);

  // Track screen view on focus
  useFocusEffect(
    React.useCallback(() => {
      if (id) {
        trackScreenView("PurchaseOrderDetail", { objectType: "purchaseOrder", objectId: id });
      }
    }, [id])
  );

  // Scan-to-receive mode: track pending receives keyed by lineId
  const [scanMode, setScanMode] = React.useState(false);
  const [scanInput, setScanInput] = React.useState("");
  const [pendingReceives, setPendingReceives] = React.useState<Map<string, number>>(new Map());
  const [scanHistory, setScanHistory] = React.useState<Array<{ lineId: string; itemId: string; delta: number }>>([])
  const [chooser, setChooser] = React.useState<{
    open: boolean;
    itemId?: string;
    candidates?: Array<{ lineId: string; itemId?: string; remaining: number; label?: string }>;
  }>({ open: false });
  const lastRefetchAt = React.useRef<number>(0);
  const scanScrollRef = React.useRef<ScrollView>(null);
  const [lastScanMessage, setLastScanMessage] = React.useState<string | null>(null);

  // Refresh on focus after edit or when data missing, throttled to avoid repeat fetches
  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      const maybeRefetch = async () => {
        const didEdit = (route.params as any)?.didEdit;
        const now = Date.now();
        if (now - lastRefetchAt.current < 2000) return;
        if (!didEdit && po) return;

        lastRefetchAt.current = now;
        if (typeof refetch === "function") {
          await refetch();
        }

        if (didEdit && active) {
          toast("PO updated", "success");
          navigation.setParams?.({ ...(route.params as any), didEdit: undefined });
        }
      };

      maybeRefetch();

      return () => {
        active = false;
      };
    }, [navigation, refetch, route.params, po, toast])
  );

  // Clear banner after a short delay
  React.useEffect(() => {
    if (!lastScanMessage) return;
    const t = setTimeout(() => setLastScanMessage(null), 2000);
    return () => clearTimeout(t);
  }, [lastScanMessage]);

  if (isLoading) return <ActivityIndicator />;

  // Deterministic idempotency key per (poId, lineId, qty, lot, location)
  const makeIdk = (poId: string, lineId: string, n: number, l?: string, loc?: string) =>
    `po:${poId}#ln:${lineId}#q:${n}#lot:${l || ""}#loc:${loc || ""}`;

  // Helper: find all lines matching an itemId
  const findLinesForItem = (itemId: string) =>
    lines.filter((line: any) => String(line.itemId).toLowerCase() === String(itemId).toLowerCase());

  // Helper: calculate remaining qty for a line
  const getRemainingQty = (line: any) =>
    Math.max(0, Number(line.qty ?? 0) - Number(line.receivedQty ?? 0));

  // Helper: apply a scan result
  const onScanResult = async (scan: string) => {
    try {
      const result = await resolveScan(scan);
      if (result.ok === false) {
        const reason = result.error.reason ?? "unknown";
        setLastScanMessage(`EPC not found: ${reason}`);
        toast(`Scan not recognized: ${reason}`, "info");
        return;
      }
      const { itemId } = result.value;
      const candidates = (lines || [])
        .map((ln: any) => {
          const lineId = String(ln?.id ?? ln?.lineId ?? "");
          const lnItemId = ln?.itemId != null ? String(ln.itemId) : undefined;
          const remaining = getRemainingQty(ln);
          const label = ln?.productName || ln?.itemId || ln?.productId || lineId;
          return { lineId, itemId: lnItemId, remaining, label };
        })
        .filter((c) => !!c.lineId && !!c.itemId && String(c.itemId).toLowerCase() === String(itemId).toLowerCase() && c.remaining > 0);

      if (candidates.length === 0) {
        setLastScanMessage("Not on this PO (or fully received)");
        toast(`Scanned item not on this PO (or fully received)`, "info");
        setScanInput("");
        return;
      }

      if (candidates.length === 1) {
        const { lineId, remaining } = candidates[0];
        const updated = incrementCapped(pendingReceives, lineId, remaining, 1);
        setPendingReceives(updated);
        setScanHistory((prev) => [...prev, { lineId, itemId, delta: 1 }]);
        setScanInput("");
        setLastScanMessage(`Staged +1 on line ${lineId}`);
        toast(`Added 1x ${itemId}`, "success");
        return;
      }

      // Multiple candidates: prompt user to pick a line
      setLastScanMessage("Multiple matches – choose a line");
      setChooser({ open: true, itemId, candidates });
      setScanInput("");
    } catch (err: any) {
      console.error(err);
      const code = err?.status || err?.code || "UNKNOWN_ERROR";
      setLastScanMessage(`Scan resolution error (${code})`);
      toast(err?.message || "Scan resolution error", "error");
    }
  };

  // Helper: create stable idempotency key for a single submit attempt
  // Uses SMOKE_RUN_ID when present; falls back to a timestamp captured once.
  const makeScanIdempotencyKey = (poId: string, lineCount: number) => {
    const runToken =
      (typeof process !== "undefined" && (process as any)?.env?.EXPO_PUBLIC_SMOKE_RUN_ID) ||
      (typeof process !== "undefined" && (process as any)?.env?.SMOKE_RUN_ID) ||
      String(Date.now());
    return `po:${poId}#scan:${runToken}#lines:${lineCount}`;
  };

  // Helper: undo last scan
  const undoLastScan = () => {
    if (scanHistory.length === 0) return;
    const last = scanHistory[scanHistory.length - 1];
    const updated = new Map(pendingReceives);
    const current = updated.get(last.lineId) ?? 0;
    if (current > 0) {
      updated.set(last.lineId, current - 1);
      setPendingReceives(updated);
    }
    setScanHistory((prev) => prev.slice(0, -1));
    toast("Undid last scan", "info");
  };

  // Helper: clear all pending
  const clearPendingReceives = () => {
    setPendingReceives(new Map());
    setScanHistory([]);
    toast("Cleared pending receives", "info");
  };

  const handleChooseLine = (choice: { lineId: string; remaining: number; itemId?: string }) => {
    const { lineId, remaining, itemId } = choice;
    const updated = incrementCapped(pendingReceives, lineId, remaining, 1);
    setPendingReceives(updated);
    if (itemId) {
      setScanHistory((prev) => [...prev, { lineId, itemId, delta: 1 }]);
      toast(`Added 1x ${itemId}`, "success");
    }
    setLastScanMessage(`Staged +1 on line ${lineId}`);
    setChooser({ open: false, candidates: [], itemId: undefined });
  };

  // Helper: submit all pending receives
  const submitPendingReceives = async () => {
    if (pendingReceives.size === 0) {
      toast("No pending receives", "info");
      return;
    }

    if (!po?.id) {
      toast("PO not loaded", "error");
      return;
    }

    const linesToReceive = Array.from(pendingReceives.entries()).map(([lineId, deltaQty]) => ({
      id: lineId,
      deltaQty,
      ...(defaultLot ? { lot: defaultLot } : {}),
      ...(defaultLocationId ? { locationId: defaultLocationId } : {}),
    }));

    // Track attempt
    track("PO_ScanReceive_Submitted", {
      objectType: "purchaseOrder",
      objectId: po.id,
      result: "attempt",
      lineCount: linesToReceive.length,
    });

    try {
      // Capture a stable idempotency key for this submit attempt
      const idempotencyKey = makeScanIdempotencyKey(po.id, linesToReceive.length);

      await receiveLines(po.id, linesToReceive, { idempotencyKey });
      toast(`Received ${linesToReceive.length} line(s)`, "success");
      setPendingReceives(new Map());
      setScanHistory([]);
      setScanMode(false);
      await refetch();

      // Track success
      track("PO_ScanReceive_Submitted", {
        objectType: "purchaseOrder",
        objectId: po.id,
        result: "success",
        lineCount: linesToReceive.length,
      });
    } catch (err: any) {
      console.error(err);
      toast(err?.message || "Submit failed", "error");

      // Track failure
      const errorCode = err?.code ?? err?.status ?? "UNKNOWN_ERROR";
      track("PO_ScanReceive_Submitted", {
        objectType: "purchaseOrder",
        objectId: po.id,
        result: "fail",
        lineCount: linesToReceive.length,
        errorCode,
      });

      // Capture exception in Sentry (dynamic require)
      try {
        const Sentry = require("@sentry/react-native");
        Sentry.captureException(err, {
          tags: {
            objectType: "purchaseOrder",
            objectId: po.id,
            action: "scan-receive",
          },
        });
      } catch {
        // Sentry not available
      }
    }
  };

  async function onReceiveLine() {
    if (!po?.id || !modal.lineId) return;
    const n = Number(qty || "0");
    if (!Number.isFinite(n) || n <= 0) { toast("Enter a qty > 0"); return; }
    try {
      await receiveLine(
        po.id,
        { id: modal.lineId, deltaQty: n, lot: lot || undefined, locationId: locationId || undefined },
        { idempotencyKey: makeIdk(po.id, modal.lineId, n, lot || undefined, locationId || undefined) }
      );
      setModal({ open: false });
      setQty("1"); setLot(""); setLocationId("");
      toast("Received", "success");
      await refetch();
    } catch (e: any) {
      console.error(e);
      toast(e?.message || "Receive failed", "error");
    }
  }

  // Only allow receive for backend-allowed statuses
  const receivable = ["approved", "partially-received"].includes(String(po?.status ?? "").toLowerCase());
  // Match banner semantics: vendor must exist AND have the "vendor" role
  const vendorHasRole =
    !!(vendorParty?.roles?.includes("vendor")) ||
    !!(po?.vendorHasVendorRole === true) ||
    !!(Array.isArray((po as any)?.vendorRoles) && (po as any).vendorRoles.includes("vendor"));
  const vendorGuardActive = !po?.vendorId || !vendorHasRole;

  // Status-aware gating
  const canEditLines = String(po?.status || "").toLowerCase() === "draft";
  const canSubmit = po?.status === "draft" && !vendorGuardActive;
  const canApprove = po?.status === "submitted" && !vendorGuardActive;
  const canCancel = (po?.status === "draft" || po?.status === "submitted") && po?.status !== "cancelled" && po?.status !== "canceled" && po?.status !== "closed";
  const canClose = po?.status === "fulfilled";

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Purchase Order </Text>
        <Pressable
          onLongPress={async () => {
            if (po?.id) {
              await copyText(String(po.id));
              toast("Copied", "success");
            }
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700" }}>{po?.id}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
        <Text>Status: {po?.status}</Text>
        {canEditLines && po?.id ? (
          <Pressable
            onPress={() => {
              track("po_detail_edit_clicked", { objectType: "purchaseOrder", objectId: po.id });
              navigation.navigate("EditPurchaseOrder", { purchaseOrderId: po.id, id: po.id });
            }}
            style={{ marginLeft: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#1976d2", borderRadius: 6, backgroundColor: "#e3f2fd" }}
          >
            <Text style={{ color: "#1976d2", fontWeight: "700" }}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Vendor identity row */}
      <View style={{ marginTop: 8, marginBottom: 4, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Vendor:</Text>
        <Text style={{ flexShrink: 1 }}>
          {vendorParty?.name || vendorParty?.displayName || po?.vendorId || "(required)"}
        </Text>
        <Pressable onPress={() => setVendorModalOpen(true)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 6 }}>
          <Text>Change</Text>
        </Pressable>
        {!!po?.vendorId && (
          <Pressable onPress={() => navigation.navigate("PartyDetail", { id: po?.vendorId })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 6 }}>
            <Text>Open</Text>
          </Pressable>
        )}
      </View>

      {/* Vendor Guard (friendly banner when missing/invalid vendor) */}
      <View style={{ marginTop: 10 }}>
        <VendorGuardBanner
          vendorId={po?.vendorId}
          vendorHasRole={!vendorGuardActive}
          onChangeVendor={() => setVendorModalOpen(true)}
        />
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {po?.status === "draft" && (
          <Pressable
            onPress={async () => {
              try {
                const r = await saveFromSuggestion(po);
                const newId = (r as any)?.id ?? (r as any)?.ids?.[0];
                if (newId && newId !== po?.id) navigation.replace("PurchaseOrderDetail", { id: newId });
                else { await refetch(); }
              } catch (e) { console.error(e); }
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: po?.status !== "draft" ? 0.5 : 1 }}
          >
            <Text>Save Draft</Text>
          </Pressable>
        )}
        <Pressable
          disabled={!canSubmit}
          onPress={async () => {
            try {
              await submit(po?.id);
              toast("Submitted", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Submit failed", "error");
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canSubmit ? 1 : 0.5 }}
        >
          <Text>Submit</Text>
        </Pressable>
        <Pressable
          disabled={!canApprove}
          onPress={async () => {
            // Track attempt
            if (po?.id) {
              track("PO_Approve_Clicked", {
                objectType: "purchaseOrder",
                objectId: po.id,
                result: "attempt",
              });
            }

            try {
              await approve(po?.id);
              toast("Approved", "success");
              await refetch();

              // Track success
              if (po?.id) {
                track("PO_Approve_Clicked", {
                  objectType: "purchaseOrder",
                  objectId: po.id,
                  result: "success",
                });
              }
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Approve failed", "error");

              // Track failure
              if (po?.id) {
                const errorCode = e?.code ?? e?.status ?? "UNKNOWN_ERROR";
                track("PO_Approve_Clicked", {
                  objectType: "purchaseOrder",
                  objectId: po.id,
                  result: "fail",
                  errorCode,
                });

                // Capture exception in Sentry (dynamic require)
                try {
                  const Sentry = require("@sentry/react-native");
                  Sentry.captureException(e, {
                    tags: {
                      objectType: "purchaseOrder",
                      objectId: po.id,
                      action: "approve",
                    },
                  });
                } catch {
                  // Sentry not available
                }
              }
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canApprove ? 1 : 0.5 }}
        >
          <Text>Approve</Text>
        </Pressable>
        {FEATURE_PO_QUICK_RECEIVE && po?.id && receivable && (
          <Pressable
            disabled={vendorGuardActive}
            onPress={async () => {
              try {
                const linesToReceive = (po?.lines ?? [])
                  .map((line: any) => {
                    const remaining = Number(line?.qty ?? 0) - Number(line?.receivedQty ?? 0);
                    if (!(remaining > 0)) return null;
                    const lineId = String(line.id ?? line.lineId);
                    const lotVal = (line?.lot ?? defaultLot ?? "").trim();
                    const locVal = (line?.locationId ?? defaultLocationId ?? "").trim();
                    return {
                      id: lineId,
                      deltaQty: remaining,
                      ...(lotVal ? { lot: lotVal } : {}),
                      ...(locVal ? { locationId: locVal } : {}),
                    };
                  })
                  .filter((ln: any) => ln && ln.deltaQty > 0);

                if (!po?.id || linesToReceive.length === 0) {
                  toast("No items to receive", "info");
                  return;
                }

                await receiveLines(po.id, linesToReceive);
                await refetch();
                toast("All items received", "success");
              } catch (e) {
                console.error(e);
                toast("Receive All failed", "error");
              }
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: vendorGuardActive ? 0.5 : 1 }}
          >
            <Text>Receive All</Text>
          </Pressable>
        )}
        <Pressable
          disabled={!canCancel}
          onPress={async () => {
            try {
              await cancel(po?.id);
              toast("Cancelled", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Cancel failed", "error");
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canCancel ? 1 : 0.5 }}
        >
          <Text>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canClose}
          onPress={async () => {
            try {
              await close(po?.id);
              toast("Closed", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Close failed", "error");
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canClose ? 1 : 0.5 }}
        >
          <Text>Close</Text>
        </Pressable>
      </View>

      {/* Scan ambiguity chooser */}
      <Modal visible={chooser.open} transparent animationType="slide" onRequestClose={() => setChooser({ open: false, candidates: [], itemId: undefined })}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "white", borderRadius: 12, padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Select line for {chooser.itemId}</Text>
            <ScrollView style={{ maxHeight: 260 }}>
              {(chooser.candidates ?? []).map((c) => (
                <Pressable
                  key={c.lineId}
                  onPress={() => handleChooseLine(c)}
                  style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: "#eee" }}
                >
                  <Text style={{ fontWeight: "700" }}>Line {c.lineId}</Text>
                  <Text style={{ color: "#444" }}>{c.label ?? c.itemId ?? ""}</Text>
                  <Text style={{ color: "#666", marginTop: 2 }}>Remaining: {c.remaining}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setChooser({ open: false, candidates: [], itemId: undefined })}
              style={{ marginTop: 12, alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: "#1976d2", fontWeight: "700" }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Order-level defaults for quick receive */}
      {receivable && (
        <View style={{ marginTop: 12, gap: 8 as any }}>
          <Text style={{ fontWeight: "700" }}>Receive Defaults</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <View style={{ width: 160 }}>
              <Text style={{ fontWeight: "600" }}>Default Lot</Text>
              <TextInput
                value={defaultLot}
                onChangeText={setDefaultLot}
                placeholder="Lot/Batch"
                style={{ borderWidth: 1, borderRadius: 8, padding: 8 }}
              />
            </View>
            <View style={{ width: 160 }}>
              <Text style={{ fontWeight: "600" }}>Default LocationId</Text>
              <TextInput
                value={defaultLocationId}
                onChangeText={setDefaultLocationId}
                placeholder="Location"
                style={{ borderWidth: 1, borderRadius: 8, padding: 8 }}
              />
            </View>
            <Btn
              label="Apply defaults to all lines"
              onPress={() => {
                // No per-line state to edit; inform operator defaults will be applied during bulk receive
                toast("Defaults will be applied to missing fields", "success");
              }}
            />
          </View>
        </View>
      )}

      {/* Scan-to-Receive Mode Button */}
      {receivable && !scanMode && (
        <View style={{ marginTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: "#ccc", paddingTop: 12 }}>
          <Btn
            label="Scan to Receive"
            onPress={() => setScanMode(true)}
          />
        </View>
      )}

      {/* Scan-to-Receive Modal */}
      <Modal visible={scanMode} animationType="slide" onRequestClose={() => setScanMode(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
            <ScrollView
              ref={(ref) => {
                scanScrollRef.current = ref;
              }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 48 }}
              style={{ flex: 1 }}
            >
              <View style={{ padding: 12, gap: 12 }}>
                {/* Header with close button */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700" }}>Scan to Receive</Text>
                  <Pressable onPress={() => setScanMode(false)} hitSlop={10}>
                    <Text style={{ fontSize: 16, color: "#1976d2", fontWeight: "600" }}>Close</Text>
                  </Pressable>
                </View>

                {lastScanMessage ? (
                  <View style={{ paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#eef7ff", borderRadius: 8, borderWidth: 1, borderColor: "#c6e2ff" }}>
                    <Text style={{ color: "#0d47a1", fontWeight: "600" }}>{lastScanMessage}</Text>
                  </View>
                ) : null}

                {/* Scanner panel */}
                <ScannerPanel
                  value={scanInput}
                  onChange={(raw) => {
                    setScanInput(raw);
                  }}
                  onSubmit={(raw) => {
                    setScanInput(raw);
                    if (raw.trim()) onScanResult(raw);
                  }}
                  onManualInputFocus={() => {
                    scanScrollRef.current?.scrollToEnd({ animated: true });
                  }}
                />

                {/* Pending receives list */}
                {pendingReceives.size > 0 && (
                  <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#e0e0e0" }}>
                    <Text style={{ fontWeight: "600", marginBottom: 8 }}>
                      Pending Receives ({pendingReceives.size})
                    </Text>
                    <ScrollView style={{ maxHeight: 200 }}>
                      {Array.from(pendingReceives.entries()).map(([lineId, delta]) => {
                        const line = lines.find(
                          (l: any) => String(l.id ?? l.lineId) === lineId
                        );
                        if (!line) return null;
                        const ordered = Number(line.qty ?? 0);
                        const received = Number(line.receivedQty ?? 0);
                        const remaining = ordered - received;
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
                                {ordered} ordered, {received} received, {remaining} remaining
                              </Text>
                              <Text style={{ fontSize: 12, fontWeight: "600", color: "#4CAF50" }}>
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
                    <Btn label="Undo Last" onPress={undoLastScan} />
                  )}
                  {pendingReceives.size > 0 && (
                    <Btn label="Clear All" onPress={clearPendingReceives} />
                  )}
                  {pendingReceives.size > 0 && (
                    <Btn
                      label={`Submit ${pendingReceives.size} line(s)`}
                      onPress={submitPendingReceives}
                    />
                  )}
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <FlatList
        style={{ marginTop: 12 }}
        data={lines}
        keyExtractor={(l: any) => String(l.id ?? l.itemId)}
        renderItem={({ item: line }: any) => {
          const canReceive = receivable && !vendorGuardActive;
          return (
            <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
              <Text>Qty: {line.qty} {line.uom || "ea"}</Text>

              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {canReceive ? (
                  <Pressable
                    onPress={() => setModal({ open: true, lineId: line.id, itemId: line.itemId })}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 8 }}
                  >
                    <Text>Receive</Text>
                  </Pressable>
                ) : null}

                {/* Receive History chip */}
                <Pressable
                  onPress={() => setHistory({ open: true, itemId: line.itemId, lineId: line.id })}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 999 }}
                >
                  <Text>Receive History</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      {/* Minimal receive modal */}
      <Modal visible={modal.open} transparent animationType="slide" onRequestClose={() => setModal({ open: false })}>
        <View style={{ flex:1, backgroundColor:"rgba(0,0,0,0.5)", justifyContent:"flex-end" }}>
          <View style={{ backgroundColor:"#fff", padding:16, borderTopLeftRadius:12, borderTopRightRadius:12 }}>
            <Text style={{ fontSize:16, fontWeight:"700", marginBottom:8 }}>Receive Line</Text>
            <Text>Item: {modal.itemId}</Text>
            <View style={{ marginTop:8 }}>
              <Text>Qty</Text>
              <TextInput value={qty} onChangeText={setQty} keyboardType="numeric" style={{ borderWidth:1, borderRadius:8, padding:8 }} />
            </View>
            <View style={{ marginTop:8 }}>
              <Text>Lot (optional)</Text>
              <TextInput value={lot} onChangeText={setLot} style={{ borderWidth:1, borderRadius:8, padding:8 }} />
            </View>
            <View style={{ marginTop:8 }}>
              <Text>Location (optional)</Text>
              <TextInput value={locationId} onChangeText={setLocationId} style={{ borderWidth:1, borderRadius:8, padding:8 }} />
            </View>
            <View style={{ flexDirection:"row", justifyContent:"flex-end", gap:12, marginTop:12 }}>
              <Pressable onPress={() => setModal({ open:false })}><Text>Cancel</Text></Pressable>
              <Pressable onPress={onReceiveLine} style={{ paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderRadius:8 }}>
                <Text>Receive</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Receive History sheet */}
      {history.open && history.itemId && history.lineId && po?.id && (
        <ReceiveHistorySheet
          itemId={history.itemId}
          poId={po.id}
          lineId={history.lineId}
          visible={history.open}
          onClose={() => setHistory({ open: false })}
        />
      )}

      {/* Vendor Picker modal */}
      <Modal visible={vendorModalOpen} animationType="slide" onRequestClose={() => setVendorModalOpen(false)}>
        <PartySelectorModal
          role="vendor"
          onClose={() => setVendorModalOpen(false)}
          onSelect={async (p) => {
            try {
              if (!po?.id) return;
              await updateObject("purchaseOrder", po.id, { vendorId: p.id });
              (toast ?? (() => {}))("Vendor set", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              (toast ?? (() => {}))(e?.message || "Failed to set vendor", "error");
            } finally {
              setVendorModalOpen(false);
            }
          }}
        />
      </Modal>
    </View>
  );
}
function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: bg, marginRight: 6 }}>
      <Text style={{ color: fg, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
function Btn({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!!disabled}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: t.colors.border,
        backgroundColor: disabled ? t.colors.border : t.colors.card,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <Text style={{ color: t.colors.text, fontWeight: "bold" as any }}>{label}</Text>
    </Pressable>
  );
}
