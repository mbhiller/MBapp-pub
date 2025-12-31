import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { track, trackScreenView } from "../lib/telemetry";
import * as Sentry from "@sentry/browser";
import {
  submitPurchaseOrder,
  approvePurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
} from "../lib/purchasing";
import { listInventoryMovements, type InventoryMovement } from "../lib/inventoryMovements";
import { friendlyPurchasingError } from "../lib/purchasingErrors";
import LocationPicker from "../components/LocationPicker";
import { resolveScan } from "@mbapp/scan";
import { resolveEpc } from "../lib/epc";

const RECEIVE_DEFAULTS_PREFIX = "mbapp_receive_defaults_";

function loadReceiveDefaults(tenantId?: string | null): { lot?: string; locationId?: string } {
  if (!tenantId) return {};
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${RECEIVE_DEFAULTS_PREFIX}${tenantId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { lot?: string; locationId?: string };
    const lot = parsed?.lot || undefined;
    const locationId = parsed?.locationId || undefined;
    return { lot, locationId };
  } catch {
    return {};
  }
}

function saveReceiveDefaults(tenantId?: string | null, value?: { lot?: string; locationId?: string }) {
  if (!tenantId) return;
  if (typeof localStorage === "undefined") return;
  const lot = value?.lot || undefined;
  const locationId = value?.locationId || undefined;
  const key = `${RECEIVE_DEFAULTS_PREFIX}${tenantId}`;
  if (!lot && !locationId) {
    localStorage.removeItem(key);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify({ lot, locationId }));
  } catch {
    // ignore storage failures
  }
}

type PurchaseOrder = {
  id: string;
  status?: string;
  vendorId?: string;
  vendorName?: string;
  created?: string;
  updated?: string;
  lines?: PurchaseLine[];
};

type PurchaseLine = {
  id?: string;
  lineId?: string;
  itemId?: string;
  productId?: string;
  qty?: number;
  orderedQty?: number;
  receivedQty?: number;
  backorderRequestIds?: string[] | null;
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

function formatConflict(err: unknown): string {
  const e = err as any;
  const code = e?.code ?? e?.details?.code;
  const message = e?.details?.message ?? e?.message;
  const parts = [] as string[];
  if (code) parts.push(String(code));
  if (message) parts.push(String(message));
  return parts.join(" · ") || formatError(err);
}

function renderFriendly(err: unknown): string {
  const f = friendlyPurchasingError(err);
  return f.hint ? `${f.title}: ${f.message} (${f.hint})` : `${f.title}: ${f.message}`;
}

/**
 * Normalize PO status for display.
 * - Use hyphen style for partial: "partially-received"
 * - Map variant input "partially_received" to "partially-received"
 */
function normalizeStatus(s: string | undefined): string {
  if (!s) return "unknown";
  const t = s.toLowerCase().replace(/_/g, "-");
  if (t === "partially-received" || t === "partially_received") return "partially-received";
  return t;
}

// Prefer canonical PO line identifier for receive payloads
function getPoLineId(line: any): string {
  if (line && typeof line.id === "string" && line.id.trim()) return String(line.id);
  if (line && typeof line.lineId === "string" && line.lineId.trim()) return String(line.lineId);
  throw new Error("Missing line identifier: this PO line has no id/lineId");
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [lineState, setLineState] = useState<
    Record<string, Partial<{ deltaQty: number; lot: string; locationId: string; editQty: number }>>
  >({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<Array<InventoryMovement & { lineId?: string }>>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(true);
  const [selectedActivityLineId, setSelectedActivityLineId] = useState<string>("all");
  const [receiveDefaults, setReceiveDefaults] = useState<{ lot?: string; locationId?: string }>({});

  // Scan-to-receive state
  const [scanInput, setScanInput] = useState<string>("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [pendingReceives, setPendingReceives] = useState<Record<string, number>>({});
  const [chooser, setChooser] = useState<{
    open: boolean;
    candidates?: Array<{ lineId: string; itemId?: string; remaining: number; label?: string }>;
    pendingScan?: string;
  }>({ open: false });

  useEffect(() => {
    const defaults = loadReceiveDefaults(tenantId);
    setReceiveDefaults(defaults);
  }, [tenantId]);

  // Track screen view on mount
  useEffect(() => {
    if (id) {
      trackScreenView("PurchaseOrderDetail", { objectType: "purchaseOrder", objectId: id });
    }
  }, [id]);

  const fetchPo = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PurchaseOrder>(`/objects/purchaseOrder/${id}`, {
        token: token || undefined,
        tenantId,
      });
      setPo(res);

      // Fetch vendor name if vendorId exists
      if (res.vendorId) {
        try {
          const vendorRes = await apiFetch<{ name?: string; displayName?: string }>(
            `/objects/party/${res.vendorId}`,
            { token: token || undefined, tenantId }
          );
          setVendorName(vendorRes?.name ?? vendorRes?.displayName ?? res.vendorId);
        } catch {
          setVendorName(res.vendorId);
        }
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [id, tenantId, token]);

  useEffect(() => {
    fetchPo();
  }, [fetchPo]);

  // Prefill deltaQty with remaining by default without overriding user inputs
  useEffect(() => {
    const lines = po?.lines ?? [];
    if (lines.length === 0) return;
    setLineState((prev) => {
      const next = { ...prev } as typeof prev;
      lines.forEach((line) => {
        const lineId = line.id ?? line.lineId ?? "";
        if (!lineId) return;
        const orderedQty = line.qty ?? line.orderedQty ?? 0;
        const receivedQty = line.receivedQty ?? 0;
        const remaining = Math.max(0, orderedQty - receivedQty);
        const cur = next[lineId];
        // Only set default if no user-provided deltaQty yet
        if (remaining > 0 && (!cur || typeof cur.deltaQty !== "number")) {
          next[lineId] = { ...(cur ?? {}), deltaQty: remaining };
        }
      });
      return next;
    });
  }, [po?.lines]);

  // Load inventory movements for PO lines
  useEffect(() => {
    const loadActivity = async () => {
      if (!po || !po.lines) {
        setActivity([]);
        setActivityError(null);
        return;
      }

      const lines = po.lines
        .map((ln) => ({
          itemId: ln.itemId ?? ln.productId,
          id: ln.id ?? ln.lineId,
        }))
        .filter((l) => l.itemId && l.id) as Array<{ itemId: string; id: string }>;

      if (lines.length === 0) {
        setActivity([]);
        setActivityError(null);
        return;
      }

      setActivityLoading(true);
      setActivityError(null);
      try {
        const results = await Promise.all(
          lines.map(async (l) => {
            const page = await listInventoryMovements(
              { itemId: l.itemId, refId: po.id, poLineId: l.id, limit: 50, sort: "desc" },
              { token: token || undefined, tenantId }
            );
            return (page.items ?? []).map((m) => ({ ...m, lineId: m.poLineId ?? l.id }));
          })
        );
        const merged = results.flat();
        merged.sort((a, b) => {
          const ta = Date.parse((a.createdAt as string) || (a as any).at || "");
          const tb = Date.parse((b.createdAt as string) || (b as any).at || "");
          if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
          if (Number.isNaN(ta)) return 1;
          if (Number.isNaN(tb)) return -1;
          return tb - ta;
        });
        setActivity(merged);
      } catch (err) {
        setActivityError(formatError(err));
      } finally {
        setActivityLoading(false);
      }
    };

    loadActivity();
  }, [po, tenantId, token]);

  const handleSubmit = async () => {
    if (!id) return;
    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await submitPurchaseOrder(id, { token: token || undefined, tenantId });
      await fetchPo();
      setActionInfo("Submitted purchase order.");
    } catch (err) {
      const e = err as any;
      if (e?.status === 409) setActionError(renderFriendly(e));
      else setActionError(renderFriendly(e));
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!id) return;
    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await approvePurchaseOrder(id, { token: token || undefined, tenantId });
      await fetchPo();
      setActionInfo("Approved purchase order.");
    } catch (err) {
      setActionError(renderFriendly(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReceive = async () => {
    if (!id || !po?.lines) return;

    // Track modal opened
    track("POReceiveModal_Opened", {
      objectType: "purchaseOrder",
      objectId: id,
    });

    // Client-side validation
    const newErrors: Record<string, string> = {};
    const linesToReceive = Object.entries(lineState)
      .map(([lineKey, state]) => {
        const qty = Number(state.deltaQty ?? 0);
        const lot = (state.lot ?? "").trim();
        const locationId = (state.locationId ?? "").trim();

        if (!Number.isFinite(qty) || qty <= 0) {
          newErrors[lineKey] = "Enter a positive quantity.";
          return null;
        }

        const line = po.lines?.find((l) => (l.id ?? l.lineId) === lineKey);
        let payloadLineId: string;
        try {
          payloadLineId = getPoLineId(line);
        } catch (e) {
          newErrors[lineKey] = "Missing line identifier; cannot receive this line.";
          return null;
        }

        const orderedQty = line?.qty ?? line?.orderedQty ?? 0;
        const receivedQty = line?.receivedQty ?? 0;
        const remaining = Math.max(0, orderedQty - receivedQty);

        if (qty > remaining) {
          newErrors[lineKey] = `Cannot receive ${qty} (only ${remaining} remaining)`;
          return null;
        }

        return {
          id: payloadLineId,
          deltaQty: qty,
          ...(lot ? { lot } : {}),
          ...(locationId ? { locationId } : {}),
        };
      })
      .filter((l): l is any => l !== null);

    setLineErrors(newErrors);

    if (Object.keys(newErrors).length > 0 || linesToReceive.length === 0) {
      setActionError("Enter a positive receive quantity for at least one line.");
      return;
    }

    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);

    // Track attempt
    track("PO_Receive_Clicked", {
      objectType: "purchaseOrder",
      objectId: id,
      result: "attempt",
      lineCount: linesToReceive.length,
    });

    try {
      // Generate idempotency key
      const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const idempotencyKey = `web-receive-${id}-${uuid}`;

      await receivePurchaseOrder(
        id,
        { lines: linesToReceive },
        { token: token || undefined, tenantId, idempotencyKey }
      );

      // Persist latest non-empty lot/locationId from this submission
      const latestLot = [...linesToReceive.map((l) => l.lot).filter(Boolean)].pop();
      const latestLocationId = [...linesToReceive.map((l) => l.locationId).filter(Boolean)].pop();
      if ((latestLot || latestLocationId) && tenantId) {
        const nextDefaults = {
          lot: latestLot ?? receiveDefaults.lot,
          locationId: latestLocationId ?? receiveDefaults.locationId,
        };
        setReceiveDefaults(nextDefaults);
        saveReceiveDefaults(tenantId, nextDefaults);
      }

      setLineState({});
      setLineErrors({});
      await fetchPo();
      setActionInfo(`Received ${linesToReceive.length} line(s).`);

      // Track success
      track("PO_Receive_Clicked", {
        objectType: "purchaseOrder",
        objectId: id,
        result: "success",
        lineCount: linesToReceive.length,
      });
    } catch (err: any) {
      setActionError(renderFriendly(err));

      // Track failure
      const errorCode = err?.code ?? err?.status ?? "UNKNOWN_ERROR";
      track("PO_Receive_Clicked", {
        objectType: "purchaseOrder",
        objectId: id,
        result: "fail",
        lineCount: linesToReceive.length,
        errorCode,
      });

      // Capture exception in Sentry
      Sentry.captureException(err, {
        tags: {
          tenantId: tenantId ?? "unknown",
          objectType: "purchaseOrder",
          objectId: id,
          action: "receive",
        },
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Bulk receive: apply order-level defaults to missing lot/location and submit one request
  const handleReceiveAllWithDefaults = async () => {
    if (!id || !po?.lines) return;

    // Build lines: remaining qty for each line; apply defaults for missing lot/location
    const missingRequired: string[] = [];
    const linesToReceive = po.lines
      .map((line) => {
        const lineId = line.id ?? line.lineId ?? "";
        if (!lineId) return null;
        const orderedQty = line.qty ?? line.orderedQty ?? 0;
        const receivedQty = line.receivedQty ?? 0;
        const remaining = Math.max(0, orderedQty - receivedQty);
        if (remaining <= 0) return null;

        const state = lineState[lineId];
        const lot = (state?.lot ?? receiveDefaults.lot ?? "").trim();
        const locationId = (state?.locationId ?? receiveDefaults.locationId ?? "").trim();

        // UX rule: require location for bulk receive (example requirement)
        const REQUIRE_LOCATION_FOR_BULK = true;
        if (REQUIRE_LOCATION_FOR_BULK && !locationId) {
          missingRequired.push(lineId);
        }

        return {
          id: getPoLineId(line),
          deltaQty: remaining,
          ...(lot ? { lot } : {}),
          ...(locationId ? { locationId } : {}),
        };
      })
      .filter((l): l is any => l !== null);

    if (linesToReceive.length === 0) {
      setActionError("No remaining quantities to receive.");
      return;
    }

    if (missingRequired.length > 0) {
      setActionError(
        `Bulk receive requires a Location; missing on lines: ${missingRequired.join(", ")}`
      );
      return;
    }

    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);
    try {
      const uuid =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const idempotencyKey = `web-bulk-receive-${id}-${uuid}`;

      await receivePurchaseOrder(
        id,
        { lines: linesToReceive },
        { token: token || undefined, tenantId, idempotencyKey }
      );

      // Persist latest non-empty lot/locationId from this submission
      const latestLot = [...linesToReceive.map((l) => l.lot).filter(Boolean)].pop();
      const latestLocationId = [...linesToReceive.map((l) => l.locationId).filter(Boolean)].pop();
      if ((latestLot || latestLocationId) && tenantId) {
        const nextDefaults = {
          lot: latestLot ?? receiveDefaults.lot,
          locationId: latestLocationId ?? receiveDefaults.locationId,
        };
        setReceiveDefaults(nextDefaults);
        saveReceiveDefaults(tenantId, nextDefaults);
      }

      await fetchPo();
      setActionInfo(`Received ${linesToReceive.length} line(s).`);
    } catch (err: any) {
      setActionError(renderFriendly(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!id) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await cancelPurchaseOrder(id, { token: token || undefined, tenantId });
      await fetchPo();
    } catch (err) {
      setActionError(renderFriendly(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleClose = async () => {
    if (!id) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await closePurchaseOrder(id, { token: token || undefined, tenantId });
      await fetchPo();
    } catch (err) {
      setActionError(renderFriendly(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReceiveRemaining = (lineId: string, remaining: number) => {
    setLineState((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], deltaQty: remaining },
    }));
    setLineErrors((prev) => ({ ...prev, [lineId]: "" }));
  };

  const handleReceiveAllRemaining = () => {
    if (!po?.lines) return;
    const newState: typeof lineState = {};
    po.lines.forEach((line) => {
      const lineId = line.id ?? line.lineId ?? "";
      const orderedQty = line.qty ?? line.orderedQty ?? 0;
      const receivedQty = line.receivedQty ?? 0;
      const remaining = Math.max(0, orderedQty - receivedQty);
      if (remaining > 0) {
        newState[lineId] = { deltaQty: remaining };
      }
    });
    setLineState(newState);
    setLineErrors({});
  };

  const handleDefaultChange = (field: "lot" | "locationId", value: string) => {
    const cleaned = value.trim();
    setReceiveDefaults((prev) => {
      const next = { ...prev, [field]: cleaned || undefined };
      saveReceiveDefaults(tenantId, next);
      return next;
    });
  };

  const handleClearDefaults = () => {
    setReceiveDefaults({});
    saveReceiveDefaults(tenantId, {});
  };

  const handleApplyDefaults = () => {
    if (!po?.lines) return;
    const { lot, locationId } = receiveDefaults;
    if (!lot && !locationId) return;
    setLineState((prev) => {
      const next = { ...prev } as typeof prev;
      po.lines?.forEach((line) => {
        const lineId = line.id ?? line.lineId ?? "";
        if (!lineId) return;
        const current = next[lineId];
        const needsLot = !current?.lot && lot;
        const needsLocation = !current?.locationId && locationId;
        if (needsLot || needsLocation) {
          next[lineId] = {
            ...(current ?? {}),
            ...(needsLot ? { lot } : {}),
            ...(needsLocation ? { locationId } : {}),
          };
        }
      });
      return next;
    });
  };

  const handleUseDefaultsForLine = (lineId: string) => {
    setLineState((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        lot: receiveDefaults.lot ?? undefined,
        locationId: receiveDefaults.locationId ?? undefined,
      },
    }));
  };

  const handleClearLineField = (lineId: string, field: "lot" | "locationId") => {
    setLineState((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        [field]: undefined,
      },
    }));
  };

  // Auto-clear scan message after 2s
  useEffect(() => {
    if (!scanMessage) return;
    const t = setTimeout(() => setScanMessage(null), 2000);
    return () => clearTimeout(t);
  }, [scanMessage]);

  // Scan-to-receive: Add handler
  const handleScanAdd = async () => {
    const code = scanInput.trim();
    if (!code) return;

    setScanLoading(true);
    setScanMessage(null);

    try {
      const result = await resolveScan(code, {
        resolveEpc: (epc) => resolveEpc(epc, { token, tenantId }),
      });

      if (result.ok === false) {
        setScanMessage(`EPC not found: ${result.error.reason ?? "unknown"}`);
        return;
      }

      const { itemId } = result.value;

      // Find matching lines with remaining qty > 0
      const candidates = (po?.lines ?? [])
        .map((ln: any) => {
          const lineId = getPoLineId(ln);
          const lnItemId = ln?.itemId != null ? String(ln.itemId) : undefined;
          const orderedQty = ln?.qty ?? ln?.orderedQty ?? 0;
          const receivedQty = ln?.receivedQty ?? 0;
          const remaining = Math.max(0, orderedQty - receivedQty);
          const label = ln?.productName || ln?.itemId || ln?.productId || lineId;
          return { lineId, itemId: lnItemId, remaining, label };
        })
        .filter(
          (c) =>
            !!c.lineId &&
            !!c.itemId &&
            String(c.itemId).toLowerCase() === String(itemId).toLowerCase() &&
            c.remaining > 0
        );

      if (candidates.length === 0) {
        setScanMessage("Not on this PO (or fully received)");
        return;
      }

      if (candidates.length === 1) {
        const { lineId, remaining } = candidates[0];
        const current = pendingReceives[lineId] ?? 0;
        const next = Math.min(current + 1, remaining);
        setPendingReceives((prev) => ({ ...prev, [lineId]: next }));
        setScanMessage(`Staged +1 on line ${lineId}`);
        setScanInput("");
        return;
      }

      // Multiple candidates: open chooser
      setChooser({ open: true, candidates, pendingScan: code });
      setScanMessage("Multiple matches – choose a line");
    } catch (err: any) {
      const code = err?.status || err?.code || "UNKNOWN_ERROR";
      setScanMessage(`Scan resolution error (${code})`);
    } finally {
      setScanLoading(false);
    }
  };

  const handleChooseLine = (choice: { lineId: string; remaining: number }) => {
    const { lineId, remaining } = choice;
    const current = pendingReceives[lineId] ?? 0;
    const next = Math.min(current + 1, remaining);
    setPendingReceives((prev) => ({ ...prev, [lineId]: next }));
    setScanMessage(`Staged +1 on line ${lineId}`);
    setChooser({ open: false });
  };

  const handleClearPending = () => {
    setPendingReceives({});
    setScanMessage(null);
  };

  const handleSubmitStaged = async () => {
    const entries = Object.entries(pendingReceives).filter(([, qty]) => qty > 0);
    if (entries.length === 0) {
      setActionError("No staged receives to submit.");
      return;
    }

    if (!id) return;

    setActionLoading(true);
    setActionError(null);
    setActionInfo(null);

    const linesToReceive = entries.map(([lineId, qty]) => ({
      lineId: lineId,
      deltaQty: qty,
      ...(receiveDefaults.lot ? { lot: receiveDefaults.lot } : {}),
      ...(receiveDefaults.locationId ? { locationId: receiveDefaults.locationId } : {}),
    }));

    try {
      const uuid =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const idempotencyKey = `web-scan-receive-${id}-${uuid}`;

      await receivePurchaseOrder(id, { lines: linesToReceive }, { token: token || undefined, tenantId, idempotencyKey });

      setPendingReceives({});
      setScanInput("");
      setScanMessage(null);
      await fetchPo();
      setActionInfo(`Received ${linesToReceive.length} line(s) via scan.`);
    } catch (err: any) {
      setActionError(renderFriendly(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <h1>Purchase Order</h1>
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>{error}</div>
        <Link to="/purchase-orders">Back to Purchase Orders</Link>
      </div>
    );
  }
  if (!po) return <div>Purchase order not found.</div>;

  const rawStatus = po.status ?? "unknown";
  const status = normalizeStatus(rawStatus);
  const lines = po.lines ?? [];

  // Status gates aligned with API handler rules:
  // - Receive handler allows: ["approved","partially-received"]
  // - Denies: ["cancelled","closed","canceled"]
  const canSubmit = status === "draft";
  const canApprove = status === "submitted";
  const canReceive = status === "approved" || status === "partially-received";
  // Cancel only allowed for draft/submitted (API: po-cancel.ts)
  const canCancel = ["draft", "submitted"].includes(status);
  // Close only allowed for fulfilled (API: po-close.ts)
  const canClose = status === "fulfilled";
  const canEditLines = ["draft", "open"].includes(status);

  const hasEdits = Object.values(lineState).some((s) => typeof s.editQty === "number");

  const handleSaveEdits = async () => {
    if (!id || !po?.lines) return;

    const newErrors: Record<string, string> = {};
    // Build updated lines array based on current PO lines and any edits
    const updatedLines = po.lines.map((line) => {
      const lineId = line.id ?? line.lineId ?? "";
      const receivedQty = line.receivedQty ?? 0;
      const currentOrdered = line.qty ?? line.orderedQty ?? 0;
      const editQty = lineState[lineId]?.editQty;
      if (typeof editQty === "number") {
        if (editQty < receivedQty) {
          newErrors[lineId] = `Ordered qty (${editQty}) cannot be less than already received (${receivedQty}).`;
          return line;
        }
        return { ...line, qty: editQty } as PurchaseLine;
      }
      return line;
    });

    setLineErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      setActionError("Fix validation errors before saving edits");
      return;
    }

    // If no edits, do nothing
    if (!hasEdits) {
      setActionError("No line edits to save.");
      return;
    }

    setActionLoading(true);
    setActionError(null);
    try {
      await apiFetch<PurchaseOrder>(`/objects/purchaseOrder/${id}`,
        { method: "PUT", body: { lines: updatedLines }, token: token || undefined, tenantId }
      );
      // Clear edit state and refresh
      setLineState({});
      setLineErrors({});
      await fetchPo();
    } catch (err) {
      setActionError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Purchase Order {po.id}</h1>
        <Link to="/purchase-orders">Back to list</Link>
      </div>

      <div style={{ display: "grid", gap: 8, padding: 16, background: "#f9f9f9", borderRadius: 4 }}>
        <div>
          <strong>Status:</strong> {status}
          <div style={{ fontSize: 12, color: "#666" }}>Server status: {rawStatus}</div>
        </div>
        <div>
          <strong>Vendor:</strong> {vendorName ?? po.vendorId ?? "Unassigned"}
        </div>
        {po.created && (
          <div>
            <strong>Created:</strong> {po.created}
          </div>
        )}
        {po.updated && (
          <div>
            <strong>Updated:</strong> {po.updated}
          </div>
        )}
      </div>

      {actionError && (
        <div style={{ padding: 12, background: "#fff4e5", color: "#8a3c00", borderRadius: 4 }}>
          {actionError}
        </div>
      )}
      {actionInfo && (
        <div style={{ padding: 12, background: "#e8f5e9", color: "#1b5e20", borderRadius: 4 }}>
          {actionInfo}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canSubmit && (
          <button onClick={handleSubmit} disabled={actionLoading}>
            {actionLoading ? "Submitting..." : "Submit"}
          </button>
        )}
        {canApprove && (
          <button onClick={handleApprove} disabled={actionLoading}>
            {actionLoading ? "Approving..." : "Approve"}
          </button>
        )}
        {canEditLines && (
          <button onClick={handleSaveEdits} disabled={actionLoading || !hasEdits}>
            {actionLoading ? "Saving..." : "Save Changes"}
          </button>
        )}
        {canReceive && (
          <>
            <button onClick={handleReceive} disabled={actionLoading}>
              {actionLoading ? "Receiving..." : "Receive"}
            </button>
            <button onClick={handleReceiveAllRemaining} disabled={actionLoading}>
              Receive All Remaining
            </button>
            <button onClick={handleReceiveAllWithDefaults} disabled={actionLoading}>
              {actionLoading ? "Receiving..." : "Receive All Remaining (Apply Defaults)"}
            </button>
          </>
        )}
        {canCancel && (
          <button onClick={handleCancel} disabled={actionLoading}>
            {actionLoading ? "Cancelling..." : "Cancel"}
          </button>
        )}
        {canClose && (
          <button onClick={handleClose} disabled={actionLoading}>
            {actionLoading ? "Closing..." : "Close"}
          </button>
        )}
        {!canClose && !["closed", "cancelled", "canceled"].includes(status) && (
          <div style={{ fontSize: 12, color: "#666", alignSelf: "center" }}>
            Close is available once PO is fulfilled.
          </div>
        )}
      </div>

      {canReceive && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontWeight: 600 }}>Default Lot</label>
            <input
              type="text"
              value={receiveDefaults.lot ?? ""}
              onChange={(e) => handleDefaultChange("lot", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Apply defaults quickly from keyboard
                  handleApplyDefaults();
                }
              }}
              placeholder="Lot/Batch"
              style={{ width: 160 }}
            />
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontWeight: 600 }}>Default LocationId</label>
            <input
              type="text"
              value={receiveDefaults.locationId ?? ""}
              onChange={(e) => handleDefaultChange("locationId", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleApplyDefaults();
                }
              }}
              placeholder="Location"
              style={{ width: 160 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleApplyDefaults} disabled={actionLoading}>
              Apply defaults to empty fields
            </button>
            <button onClick={handleClearDefaults} disabled={actionLoading}>
              Clear defaults
            </button>
          </div>
        </div>
      )}

      {canReceive && (
        <div style={{ display: "grid", gap: 12, padding: 16, background: "#f0f8ff", borderRadius: 4, border: "1px solid #b3d9ff" }}>
          <h3 style={{ margin: 0 }}>Scan to Receive (Manual Entry)</h3>

          {scanMessage && (
            <div style={{ padding: 8, background: "#e3f2fd", color: "#0d47a1", borderRadius: 4, fontSize: 14 }}>
              {scanMessage}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ display: "grid", gap: 4, flex: 1, maxWidth: 400 }}>
              <label style={{ fontWeight: 600 }}>Paste EPC or barcode</label>
              <input
                type="text"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleScanAdd();
                  }
                }}
                placeholder="EPC, QR code, or item ID"
                disabled={scanLoading || actionLoading}
                style={{ padding: 8, fontSize: 14 }}
              />
            </div>
            <button onClick={handleScanAdd} disabled={scanLoading || actionLoading || !scanInput.trim()}>
              {scanLoading ? "Resolving..." : "Add"}
            </button>
          </div>

          {Object.keys(pendingReceives).length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>Staged Receives ({Object.keys(pendingReceives).length} line(s))</strong>
                <button onClick={handleClearPending} disabled={actionLoading} style={{ fontSize: 12, padding: "4px 8px" }}>
                  Clear All
                </button>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {Object.entries(pendingReceives).map(([lineId, qty]) => {
                  const line = po?.lines?.find((l: any) => getPoLineId(l) === lineId);
                  const itemId = line?.itemId ?? line?.productId ?? "—";
                  const orderedQty = line?.qty ?? line?.orderedQty ?? 0;
                  const receivedQty = line?.receivedQty ?? 0;
                  const remaining = Math.max(0, orderedQty - receivedQty);
                  return (
                    <div
                      key={lineId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: 8,
                        background: "#fff",
                        borderRadius: 4,
                        border: "1px solid #ddd",
                      }}
                    >
                      <div>
                        <strong>{itemId}</strong> (Line {lineId})
                      </div>
                      <div style={{ fontSize: 14, color: "#4caf50", fontWeight: 600 }}>
                        +{qty} (remaining: {remaining})
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={handleSubmitStaged} disabled={actionLoading} style={{ fontWeight: 600, padding: "10px 16px" }}>
                {actionLoading ? "Submitting..." : `Submit Staged (${Object.keys(pendingReceives).length} line(s))`}
              </button>
            </div>
          )}
        </div>
      )}

      {chooser.open && chooser.candidates && chooser.candidates.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setChooser({ open: false })}
        >
          <div
            style={{
              background: "#fff",
              padding: 24,
              borderRadius: 8,
              maxWidth: 500,
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Choose Line</h3>
            <p style={{ color: "#666", fontSize: 14 }}>Multiple lines match this item. Select which line to receive:</p>
            <div style={{ display: "grid", gap: 8 }}>
              {chooser.candidates.map((c) => (
                <button
                  key={c.lineId}
                  onClick={() => handleChooseLine(c)}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    background: "#f9f9f9",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{c.label || c.itemId}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    Line {c.lineId} · {c.remaining} remaining
                  </div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button onClick={() => setChooser({ open: false })} style={{ padding: "8px 16px" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <h2>Lines</h2>
      {lines.length === 0 ? (
        <div>No lines.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#eee" }}>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Line ID</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Item</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Ordered</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Received</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Remaining</th>
                {canReceive && (
                  <>
                    <th style={{ padding: 8, border: "1px solid #ccc" }}>Delta Qty</th>
                    <th style={{ padding: 8, border: "1px solid #ccc" }}>Lot</th>
                    <th style={{ padding: 8, border: "1px solid #ccc" }}>Location</th>
                    <th style={{ padding: 8, border: "1px solid #ccc" }}>Actions</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineId = line.id ?? line.lineId ?? "";
                const itemId = line.itemId ?? line.productId ?? "—";
                const orderedQty = line.qty ?? line.orderedQty ?? 0;
                const receivedQty = line.receivedQty ?? 0;
                const remaining = Math.max(0, orderedQty - receivedQty);
                const state = lineState[lineId] ?? { deltaQty: 0 };
                const error = lineErrors[lineId];

                return (
                  <tr key={lineId}>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{lineId}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{itemId}</td>
                    <td style={{ padding: 8, border: `1px solid ${error ? "#d32f2f" : "#ccc"}`, background: error ? "#ffebee" : "transparent" }}>
                      {canEditLines ? (
                        <div>
                          <input
                            type="number"
                            min={receivedQty}
                            value={typeof state.editQty === "number" ? state.editQty : orderedQty}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setLineState((prev) => ({
                                ...prev,
                                [lineId]: { ...prev[lineId], editQty: isNaN(val) ? undefined : Math.max(val, receivedQty) },
                              }));
                              setLineErrors((prev) => ({ ...prev, [lineId]: "" }));
                            }}
                            style={{ width: 70 }}
                          />
                          {typeof state.editQty === "number" && state.editQty < receivedQty && (
                            <div style={{ fontSize: 11, color: "#d32f2f", marginTop: 2 }}>
                              Ordered cannot be less than received ({receivedQty}).
                            </div>
                          )}
                        </div>
                      ) : (
                        <span>{orderedQty}</span>
                      )}
                    </td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{receivedQty}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{remaining}</td>
                    {canReceive && (
                      <>
                        <td style={{ padding: 8, border: `1px solid ${error ? "#d32f2f" : "#ccc"}`, background: error ? "#ffebee" : "transparent" }}>
                          <div>
                            <input
                              type="number"
                              min="0"
                              value={state.deltaQty ?? 0}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setLineState((prev) => ({
                                  ...prev,
                                  [lineId]: { ...prev[lineId], deltaQty: val >= 0 ? val : 0 },
                                }));
                                setLineErrors((prev) => ({ ...prev, [lineId]: "" }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  // Submit current selection of lines
                                  handleReceive();
                                }
                              }}
                              style={{ width: 70 }}
                            />
                          </div>
                          {error && <div style={{ fontSize: 11, color: "#d32f2f", marginTop: 2 }}>{error}</div>}
                        </td>
                        <td style={{ padding: 8, border: "1px solid #ccc" }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              type="text"
                              placeholder="Lot/Batch"
                              value={state.lot ?? ""}
                              onChange={(e) => {
                                setLineState((prev) => ({
                                  ...prev,
                                  [lineId]: { ...prev[lineId], lot: e.target.value || undefined },
                                }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleReceive();
                                }
                              }}
                              style={{ width: 90 }}
                            />
                            {(state.lot ?? "") !== "" && (
                              <button
                                onClick={() => handleClearLineField(lineId, "lot")}
                                style={{ padding: "2px 6px", fontSize: 12 }}
                                aria-label="Clear lot"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: 8, border: "1px solid #ccc" }}>
                          <div style={{ display: "grid", gap: 6 }}>
                            <LocationPicker
                              value={state.locationId ?? ""}
                              onChange={(newId) => {
                                const val = String(newId || "").trim();
                                setLineState((prev) => ({
                                  ...prev,
                                  [lineId]: { ...prev[lineId], locationId: val || undefined },
                                }));
                              }}
                              disabled={actionLoading}
                            />
                            <div style={{ display: "flex", gap: 8 }}>
                              {(state.locationId ?? "") !== "" && (
                                <button
                                  onClick={() => handleClearLineField(lineId, "locationId")}
                                  style={{ padding: "2px 6px", fontSize: 12 }}
                                  aria-label="Clear location"
                                >
                                  Clear
                                </button>
                              )}
                              <button
                                onClick={() => handleUseDefaultsForLine(lineId)}
                                disabled={actionLoading}
                                style={{ fontSize: 12, padding: "2px 6px" }}
                              >
                                Use defaults
                              </button>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: 8, border: "1px solid #ccc" }}>
                          {remaining > 0 && (
                            <button
                              onClick={() => handleReceiveRemaining(lineId, remaining)}
                              disabled={actionLoading}
                              style={{ fontSize: 12, padding: "4px 8px", whiteSpace: "nowrap" }}
                            >
                              Receive Remaining
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Backorder Linkage Section */}
      {po?.lines?.some((line) => line.backorderRequestIds?.length) && (
        <div style={{ display: "grid", gap: 8, padding: 16, background: "#f0f7ff", borderRadius: 4, border: "1px solid #90caf9" }}>
          <h3 style={{ margin: 0, color: "#1976d2", fontSize: 16, fontWeight: 600 }}>
            Backorder Fulfillment
          </h3>
          <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#666" }}>
            This purchase order is fulfilling the following backorder requests:
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {po.lines
              .filter((line) => line.backorderRequestIds?.length)
              .map((line) => {
                const lineId = line.id ?? line.lineId ?? "";
                const itemId = line.itemId ?? line.productId ?? "—";
                return (
                  <div key={lineId} style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>
                      {lineId} ({itemId})
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {line.backorderRequestIds!.map((boId) => {
                        // Primary link goes to backorder detail page
                        return (
                          <Link
                            key={boId}
                            to={`/backorders/${boId}`}
                            title={`View backorder ${boId} detail`}
                            style={{
                              display: "inline-block",
                              padding: "4px 12px",
                              background: "#1976d2",
                              color: "#fff",
                              borderRadius: 3,
                              textDecoration: "none",
                              fontSize: 12,
                              fontWeight: 500,
                            }}
                          >
                            {boId}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Activity</h2>
          <button onClick={() => setActivityCollapsed((c) => !c)} style={{ padding: "4px 8px" }}>
            {activityCollapsed ? "Expand" : "Collapse"}
          </button>
          {activityLoading && <span style={{ fontSize: 12, color: "#666" }}>Loading…</span>}
          {activityError && (
            <span style={{ fontSize: 12, color: "#c00" }}>Activity unavailable — {activityError}</span>
          )}
        </div>

        {!activityCollapsed && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>Filter by line:</label>
              <select
                value={selectedActivityLineId}
                onChange={(e) => setSelectedActivityLineId(e.target.value)}
                style={{ padding: "4px 8px", fontSize: 14 }}
              >
                <option value="all">All lines</option>
                {po?.lines?.map((line) => {
                  const lineId = line.id ?? line.lineId ?? "";
                  const itemId = line.itemId ?? line.productId ?? "";
                  const itemLabel = itemId.length > 20 ? itemId.slice(0, 17) + "..." : itemId;
                  return (
                    <option key={lineId} value={lineId}>
                      {lineId} ({itemLabel})
                    </option>
                  );
                })}
              </select>
            </div>

            <div style={{ overflowX: "auto" }}>
              {activity.length === 0 && !activityLoading ? (
                <div style={{ color: "#666", padding: 8 }}>No activity yet.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ textAlign: "left", background: "#f6f6f6" }}>
                      <th style={{ padding: 8, border: "1px solid #ccc" }}>Timestamp</th>
                      <th style={{ padding: 8, border: "1px solid #ccc" }}>Action</th>
                      <th style={{ padding: 8, border: "1px solid #ccc" }}>Qty</th>
                      <th style={{ padding: 8, border: "1px solid #ccc" }}>Line</th>
                      <th style={{ padding: 8, border: "1px solid #ccc" }}>Lot</th>
                      <th style={{ padding: 8, border: "1px solid #ccc" }}>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity
                      .filter((mv) =>
                        selectedActivityLineId === "all"
                          ? true
                          : (mv.lineId ?? mv.poLineId) === selectedActivityLineId
                      )
                      .map((mv, idx) => {
                        const timestamp = mv.createdAt || (mv as any).at || "(no timestamp)";
                        return (
                          <tr key={`${mv.id ?? idx}-${mv.lineId ?? "line"}`}>
                            <td style={{ padding: 8, border: "1px solid #ccc" }}>{timestamp}</td>
                            <td style={{ padding: 8, border: "1px solid #ccc" }}>{mv.action ?? ""}</td>
                            <td style={{ padding: 8, border: "1px solid #ccc" }}>{mv.qty ?? ""}</td>
                            <td style={{ padding: 8, border: "1px solid #ccc" }}>{mv.lineId ?? mv.poLineId ?? ""}</td>
                            <td style={{ padding: 8, border: "1px solid #ccc" }}>{mv.lot ?? ""}</td>
                            <td style={{ padding: 8, border: "1px solid #ccc" }}>{mv.locationId ?? ""}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
