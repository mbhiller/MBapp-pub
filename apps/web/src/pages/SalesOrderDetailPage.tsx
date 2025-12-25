import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type SalesOrderLine = {
  id: string;
  itemId?: string;
  qty?: number;
  qtyCommitted?: number;
  qtyFulfilled?: number;
  uom?: string;
};

type BackorderRequest = {
  id: string;
  type: "backorderRequest";
  soId?: string;
  soLineId?: string;
  itemId?: string;
  qty?: number;
  status?: string;
  preferredVendorId?: string;
};

type ShortageRow = {
  lineId?: string;
  itemId: string;
  requested?: number;
  available?: number;
  backordered?: number;
};

type ShortageInfo = {
  kind: "commit" | "reserve";
  message: string;
  rows: ShortageRow[];
};

type SalesOrder = {
  id: string;
  status?: string;
  partyId?: string;
  customerId?: string;
  notes?: string;
  lines?: SalesOrderLine[];
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

function toLineQtys(lines?: SalesOrderLine[]): Record<string, number> {
  const map: Record<string, number> = {};
  (lines ?? []).forEach((ln) => {
    if (ln.id) map[ln.id] = Math.max(1, Number(ln.qty ?? 1));
  });
  return map;
}

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, tenantId } = useAuth();
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [strictCommit, setStrictCommit] = useState(false);
  const [lineQtys, setLineQtys] = useState<Record<string, number>>({});
  const [releaseReason, setReleaseReason] = useState("UI release");
  const [shortageInfo, setShortageInfo] = useState<ShortageInfo | null>(null);
  const [backorders, setBackorders] = useState<BackorderRequest[]>([]);
  const [backordersLoading, setBackordersLoading] = useState(false);
  const [backordersError, setBackordersError] = useState<string | null>(null);
  const [vendorNameById, setVendorNameById] = useState<Record<string, string>>({});

  const fetchBackorders = useCallback(async () => {
    if (!id) return;
    setBackordersLoading(true);
    setBackordersError(null);
    try {
      const res = await apiFetch<{ items?: BackorderRequest[] }>("/objects/backorderRequest/search", {
        method: "POST",
        token: token || undefined,
        tenantId,
        body: { soId: id, status: "open" },
      });
      setBackorders(res.items ?? []);
    } catch (err) {
      setBackordersError(formatError(err));
    } finally {
      setBackordersLoading(false);
    }
  }, [id, tenantId, token]);

  const fetchOnhandBatch = useCallback(
    async (itemIds: string[]) => {
      if (itemIds.length === 0) return [];
      try {
        const res = await apiFetch<{ items?: Array<{ itemId: string; onHand: number; reserved: number; available: number; asOf: string }> }>(
          "/inventory/onhand:batch",
          {
            method: "POST",
            token: token || undefined,
            tenantId,
            body: { itemIds },
          }
        );
        return res.items ?? [];
      } catch (err) {
        console.error("Onhand batch fetch failed:", err);
        return [];
      }
    },
    [tenantId, token]
  );

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<SalesOrder>(`/objects/salesOrder/${id}`, {
        token: token || undefined,
        tenantId,
      });
      setOrder(res);
      setLineQtys(toLineQtys(res.lines));
      setShortageInfo(null);
      await fetchBackorders();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [id, tenantId, token, fetchBackorders]);

  useEffect(() => {
    const preferredVendorIds = Array.from(
      new Set(
        backorders
          .map((bo) => bo.preferredVendorId)
          .filter((v): v is string => Boolean(v))
      )
    );

    const missing = preferredVendorIds.filter((v) => !(v in vendorNameById));
    if (missing.length === 0) return;

    (async () => {
      const entries: Record<string, string> = {};
      await Promise.all(
        missing.map(async (vendorId) => {
          try {
            const res = await apiFetch<{ name?: string; displayName?: string }>(`/objects/party/${vendorId}`, {
              token: token || undefined,
              tenantId,
            });
            const name = (res as any)?.name ?? (res as any)?.displayName ?? vendorId;
            entries[vendorId] = name;
          } catch {
            entries[vendorId] = vendorId;
          }
        })
      );
      setVendorNameById((prev) => ({ ...prev, ...entries }));
    })();
  }, [backorders, tenantId, token, vendorNameById]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const linesPayload = useCallback(
    () =>
      (order?.lines ?? [])
        .map((ln) => ({
          lineId: ln.id,
          deltaQty: Math.max(0, Number(lineQtys[ln.id] ?? 0)),
        }))
        .filter((ln) => ln.deltaQty > 0),
    [lineQtys, order?.lines]
  );

  const performAction = useCallback(
    async (action: string, body?: Record<string, unknown>) => {
      if (!id) return;
      setActionError(null);
      setActionLoading(action);
      setShortageInfo(null);
      try {
        await apiFetch(`/sales/so/${id}:${action}`, {
          method: "POST",
          token: token || undefined,
          tenantId,
          body,
        });
        await fetchOrder();
        if (action === "commit" || action === "fulfill") {
          await fetchBackorders();
        }
      } catch (err) {
        const e = err as any;
        const details = e?.details || {};
        const shortages = Array.isArray(details?.shortages) ? details.shortages : [];

        if (e?.status === 409 && shortages.length > 0) {
          const rows: ShortageRow[] = shortages.map((s: any) => ({
            lineId: s?.lineId,
            itemId: s?.itemId,
            requested: s?.requested,
            available: s?.available,
            backordered: s?.backordered,
          }));
          setShortageInfo({
            kind: action === "commit" ? "commit" : "reserve",
            message: details?.message || e?.message || "Insufficient availability",
            rows,
          });
          return;
        }

        setActionError(formatError(err));
      } finally {
        setActionLoading(null);
      }
    },
    [fetchOrder, id, tenantId, token]
  );

  const handleCommit = async () => {
    setShortageInfo(null);

    // Helper: defensive accessor for fulfilled qty (handles multiple field names)
    const getFulfilledQty = (line: any) =>
      Number(line.fulfilledQty ?? line.qtyFulfilled ?? line.qtyFulfilledTotal ?? 0) || 0;

    // Precheck: compute requested qty per item from SO lines
    const lines = order?.lines ?? [];
    const itemQtyMap = new Map<string, number>();
    for (const ln of lines) {
      const itemId = ln.itemId;
      if (!itemId) continue;
      const qty = Number(ln.qty ?? 0) || 0;
      const fulfilled = getFulfilledQty(ln);
      const requested = Math.max(0, qty - fulfilled);
      if (requested <= 0) continue;
      itemQtyMap.set(itemId, (itemQtyMap.get(itemId) ?? 0) + requested);
    }

    if (itemQtyMap.size > 0) {
      const itemIds = Array.from(itemQtyMap.keys());
      const availabilityItems = await fetchOnhandBatch(itemIds);
      const availabilityMap = new Map(availabilityItems.map((it) => [it.itemId, it.available]));

      const precheckShortages: ShortageRow[] = [];
      for (const [itemId, requested] of itemQtyMap) {
        const available = availabilityMap.get(itemId) ?? 0;
        if (requested > available) {
          precheckShortages.push({ itemId, requested, available });
        }
      }

      if (precheckShortages.length > 0) {
        setShortageInfo({
          kind: "commit",
          message: "Precheck: Insufficient availability detected",
          rows: precheckShortages,
        });

        const shouldProceed = window.confirm(
          strictCommit
            ? `Strict commit will fail due to ${precheckShortages.length} shortage(s). Proceed anyway to see server response?`
            : `Non-strict commit will create ${precheckShortages.length} backorder(s). Proceed?`
        );
        if (!shouldProceed) return;
      }
    }

    await performAction("commit", { strict: strictCommit });
  };

  const handleReserve = async () => {
    const payload = linesPayload();
    if (payload.length === 0) {
      setActionError("Add a quantity for at least one line before reserving");
      return;
    }

    setShortageInfo(null);

    // Precheck: compute requested qty per item from user-entered deltas
    const soLinesMap = new Map((order?.lines ?? []).map((ln) => [ln.id, ln]));
    const itemQtyMap = new Map<string, number>();
    for (const { lineId, deltaQty } of payload) {
      const line = soLinesMap.get(lineId);
      const itemId = line?.itemId;
      if (!itemId || deltaQty <= 0) continue;
      itemQtyMap.set(itemId, (itemQtyMap.get(itemId) ?? 0) + deltaQty);
    }

    if (itemQtyMap.size > 0) {
      const itemIds = Array.from(itemQtyMap.keys());
      const availabilityItems = await fetchOnhandBatch(itemIds);
      const availabilityMap = new Map(availabilityItems.map((it) => [it.itemId, it.available]));

      const precheckShortages: ShortageRow[] = [];
      for (const [itemId, requested] of itemQtyMap) {
        const available = availabilityMap.get(itemId) ?? 0;
        if (requested > available) {
          precheckShortages.push({ itemId, requested, available });
        }
      }

      if (precheckShortages.length > 0) {
        setShortageInfo({
          kind: "reserve",
          message: "Precheck: Insufficient availability detected",
          rows: precheckShortages,
        });

        const shouldProceed = window.confirm(
          `Reserve will fail due to ${precheckShortages.length} shortage(s). Proceed anyway to see server response?`
        );
        if (!shouldProceed) return;
      }
    }

    await performAction("reserve", { lines: payload });
  };

  const handleRelease = async () => {
    const payload = linesPayload();
    if (payload.length === 0) {
      setActionError("Add a quantity for at least one line before releasing");
      return;
    }
    await performAction("release", { lines: payload.map((ln) => ({ ...ln, reason: releaseReason || undefined })) });
  };

  const handleFulfill = async () => {
    const payload = linesPayload();
    if (payload.length === 0) {
      setActionError("Add a quantity for at least one line before fulfilling");
      return;
    }
    await performAction("fulfill", { lines: payload });
  };

  const status = order?.status ?? "";
  const canSubmit = status === "draft";
  const canCommit = status === "submitted" || status === "committed" || status === "draft";
  const canReserve = status === "submitted" || status === "committed";
  const canRelease = status !== "cancelled" && status !== "closed" && status !== "draft";
  const canFulfill = status === "committed" || status === "partially_fulfilled" || status === "submitted";
  const canClose = status === "fulfilled" || status === "partially_fulfilled" || status === "committed";
  const canCancel = status !== "cancelled" && status !== "closed" && status !== "fulfilled";

  const lines = useMemo(() => order?.lines ?? [], [order?.lines]);

  if (!id) return <div>Missing sales order id</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0 }}>Sales Order Detail</h1>
            {backorders.length > 0 && (
              <div style={{ padding: "4px 8px", background: "#fff4e5", color: "#8a3c00", borderRadius: 4, fontSize: 12, fontWeight: 600, border: "1px solid #f2c97d" }}>
                Backorders: {backorders.length} ({backorders.reduce((sum, bo) => sum + (bo.qty ?? 0), 0)} units)
              </div>
            )}
          </div>
          <div style={{ color: "#555" }}>ID: {id}</div>
          <div>Status: {status || ""}</div>
          <div>Party: {order?.partyId || ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/sales-orders/${id}/edit`}>Edit</Link>
          <Link to="/sales-orders">Back to list</Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={fetchOrder} disabled={loading}>Refresh</button>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={strictCommit} onChange={(e) => setStrictCommit(e.target.checked)} /> Strict commit
        </label>
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ padding: 12, background: "#fee", color: "#b00020", borderRadius: 4 }}>{error}</div> : null}
      {actionError ? <div style={{ padding: 12, background: "#fff4e5", color: "#8a3c00", borderRadius: 4 }}>{actionError}</div> : null}

      <section style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Lines</h3>
        {lines.length === 0 ? <div>No lines</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#eee" }}>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Line</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Item</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Qty</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Committed</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Fulfilled</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.id}>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{ln.id}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{ln.itemId}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{ln.qty ?? ""} {ln.uom ?? ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{ln.qtyCommitted ?? 0}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{ln.qtyFulfilled ?? 0}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={lineQtys[ln.id] ?? 1}
                      onChange={(e) => setLineQtys((prev) => ({ ...prev, [ln.id]: Number(e.target.value) }))}
                      style={{ width: 100 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Open Backorders</h3>
        {backordersLoading ? (
          <div>Loading backorders...</div>
        ) : backordersError ? (
          <div style={{ padding: 8, background: "#fee", color: "#b00020", borderRadius: 4, fontSize: 12 }}>{backordersError}</div>
        ) : backorders.length === 0 ? (
          <div style={{ color: "#777", fontSize: 14 }}>No open backorders</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#eee" }}>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Item</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Qty</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Status</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {backorders.map((bo) => (
                <tr key={bo.id}>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.itemId ?? "—"}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{Number(bo.qty ?? 0)}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.status ?? "—"}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>
                    {bo.preferredVendorId
                      ? vendorNameById[bo.preferredVendorId] ?? bo.preferredVendorId
                      : "Unassigned"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Actions</h3>
        {shortageInfo ? (
          <div style={{ padding: 12, background: "#fff4e5", color: "#8a3c00", borderRadius: 4, border: "1px solid #f2c97d" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Insufficient availability</div>
            <div style={{ marginBottom: 6 }}>{shortageInfo.message}</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {shortageInfo.rows.map((row, idx) => (
                <li key={idx}>
                  Item {row.itemId ?? ""}
                  {row.lineId ? ` (line ${row.lineId})` : ""}
                  {row.backordered !== undefined
                    ? ` · backordered ${row.backordered}`
                    : ` · requested ${row.requested ?? "?"} / available ${row.available ?? "?"}`}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {canSubmit ? (
            <button onClick={() => performAction("submit")} disabled={!!actionLoading}>
              {actionLoading === "submit" ? "Submitting..." : "Submit"}
            </button>
          ) : null}
          {canCommit ? (
            <button onClick={handleCommit} disabled={!!actionLoading}>
              {actionLoading === "commit" ? "Committing..." : "Commit"}
            </button>
          ) : null}
          {canReserve ? (
            <button onClick={handleReserve} disabled={!!actionLoading}>
              {actionLoading === "reserve" ? "Reserving..." : "Reserve"}
            </button>
          ) : null}
          {canRelease ? (
            <button onClick={handleRelease} disabled={!!actionLoading}>
              {actionLoading === "release" ? "Releasing..." : "Release"}
            </button>
          ) : null}
          {canFulfill ? (
            <button onClick={handleFulfill} disabled={!!actionLoading}>
              {actionLoading === "fulfill" ? "Fulfilling..." : "Fulfill"}
            </button>
          ) : null}
          {canClose ? (
            <button onClick={() => performAction("close")} disabled={!!actionLoading}>
              {actionLoading === "close" ? "Closing..." : "Close"}
            </button>
          ) : null}
          {canCancel ? (
            <button onClick={() => performAction("cancel")} disabled={!!actionLoading}>
              {actionLoading === "cancel" ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
          <button onClick={() => navigate(`/sales-orders/${id}/edit`)}>Edit</button>
        </div>
        {canRelease ? (
          <label style={{ display: "grid", gap: 4, maxWidth: 360 }}>
            <span>Release reason (optional)</span>
            <input value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} />
          </label>
        ) : null}
      </section>
    </div>
  );
}
