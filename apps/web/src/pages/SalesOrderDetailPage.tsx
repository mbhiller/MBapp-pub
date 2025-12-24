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

type Backorder = {
  id?: string;
  soId?: string;
  soLineId?: string;
  itemId?: string;
  qty?: number;
  status?: string;
  preferredVendorId?: string;
};

type SalesOrder = {
  id: string;
  status?: string;
  partyId?: string;
  customerId?: string;
  notes?: string;
  lines?: SalesOrderLine[];
  backorders?: Array<{ lineId?: string; itemId?: string; backordered?: number }>;
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
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [id, tenantId, token]);

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
      try {
        await apiFetch(`/sales/so/${id}:${action}`, {
          method: "POST",
          token: token || undefined,
          tenantId,
          body,
        });
        await fetchOrder();
      } catch (err) {
        setActionError(formatError(err));
      } finally {
        setActionLoading(null);
      }
    },
    [fetchOrder, id, tenantId, token]
  );

  const handleCommit = async () => {
    await performAction("commit", { strict: strictCommit });
  };

  const handleReserve = async () => {
    const payload = linesPayload();
    if (payload.length === 0) {
      setActionError("Add a quantity for at least one line before reserving");
      return;
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
  const backorders = useMemo(() => order?.backorders ?? [], [order?.backorders]);

  if (!id) return <div>Missing sales order id</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ margin: 0 }}>Sales Order Detail</h1>
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

      {backorders.length > 0 ? (
        <section style={{ display: "grid", gap: 6 }}>
          <h4 style={{ margin: 0 }}>Backorders</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {backorders.map((bo, idx) => (
              <li key={idx}>
                Line {bo.lineId ?? ""} · Item {bo.itemId ?? ""} · Backordered {bo.backordered ?? ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Actions</h3>
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
