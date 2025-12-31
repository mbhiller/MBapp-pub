import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import {
  createPurchaseOrdersFromSuggestion,
  suggestPurchaseOrders,
  type PurchaseOrderDraft,
  type SuggestPoResponse,
} from "../lib/api";

function formatError(err: unknown): string {
  const e = err as any;
  if (e?.message) return e.message;
  if (e?.statusText && e?.status) return `${e.status} ${e.statusText}`;
  return "Request failed";
}

function DraftCard({ draft }: { draft: PurchaseOrderDraft }) {
  const lines = draft.lines || [];
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Vendor: {draft.vendorId || "(unknown)"}</div>
        {draft.status && <div style={{ fontSize: 12, color: "#666" }}>Status: {draft.status}</div>}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {lines.length === 0 && <div style={{ color: "#666" }}>No lines suggested.</div>}
        {lines.map((ln, idx) => (
          <div
            key={ln.id || ln.lineId || `${ln.itemId || "line"}-${idx}`}
            style={{ padding: 8, border: "1px solid #eee", borderRadius: 6, background: "#fafafa" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontWeight: 600 }}>Item: {ln.itemId || "(unknown)"}</div>
              <div>Qty: {ln.qty ?? "—"}</div>
            </div>
            {(ln.minOrderQtyApplied != null || ln.adjustedFrom != null) && (
              <div style={{ fontSize: 12, color: "#555" }}>
                {ln.minOrderQtyApplied != null && <span>MOQ Applied: {ln.minOrderQtyApplied} </span>}
                {ln.adjustedFrom != null && <span>(from {ln.adjustedFrom})</span>}
              </div>
            )}
            {ln.backorderRequestIds?.length ? (
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                Backorders: {ln.backorderRequestIds.join(", ")}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SuggestPurchaseOrdersPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { token, tenantId } = useAuth();

  const vendorIdFromState = (location.state as any)?.vendorId as string | undefined;
  const vendorIdFromQuery = new URLSearchParams(location.search || "").get("vendorId") || undefined;
  const vendorId = vendorIdFromState ?? vendorIdFromQuery;

  const [resp, setResp] = useState<SuggestPoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createdIds, setCreatedIds] = useState<string[]>([]);

  const drafts = useMemo<PurchaseOrderDraft[]>(
    () => resp?.drafts ?? (resp?.draft ? [resp.draft] : []),
    [resp]
  );
  const skipped = resp?.skipped ?? [];

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      setActionError(null);
      setCreatedIds([]);
      try {
        const res = await suggestPurchaseOrders([id], { vendorId, token, tenantId });
        setResp(res ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, vendorId]);

  const handleCreate = async () => {
    if (!drafts.length) {
      setActionError("No drafts to create");
      return;
    }
    setCreating(true);
    setActionError(null);
    try {
      const res = await createPurchaseOrdersFromSuggestion(drafts.length === 1 ? drafts[0] : drafts, { token, tenantId });
      const ids = res?.ids ?? (res?.id ? [res.id] : []);
      setCreatedIds(ids);
      if (ids.length > 0) navigate(`/purchase-orders/${encodeURIComponent(ids[0])}`);
    } catch (err) {
      setActionError(formatError(err));
    } finally {
      setCreating(false);
    }
  };

  if (!id) {
    return (
      <div style={{ padding: 24 }}>
        <div>Missing backorder ID.</div>
        <button onClick={() => navigate("/backorders")}>← Back to Backorders</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div>Suggesting purchase order drafts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: "#b00020", marginBottom: 12 }}>Error: {error}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate(`/backorders/${encodeURIComponent(id)}`)}>← Back to Backorder</button>
          <button onClick={() => navigate(`/backorders/${encodeURIComponent(id)}/suggest-po`)}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Suggest Purchase Orders</h1>
          <div style={{ color: "#555", marginTop: 4 }}>Backorder ID: {id}</div>
          {vendorId && <div style={{ color: "#555", marginTop: 4 }}>Vendor: {vendorId}</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate(`/backorders/${encodeURIComponent(id)}`)}>← Back to Backorder</button>
          <button onClick={() => navigate("/backorders")}>Backorders List</button>
        </div>
      </div>

      {actionError && (
        <div style={{ padding: 12, marginBottom: 12, background: "#fee", color: "#b00020", borderRadius: 6 }}>
          {actionError}
        </div>
      )}

      {createdIds.length > 1 && (
        <div style={{ padding: 12, marginBottom: 12, background: "#e8f5e9", borderRadius: 6, border: "1px solid #c8e6c9" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Created Purchase Orders:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {createdIds.map((poId) => (
              <Link key={poId} to={`/purchase-orders/${poId}`} style={{ color: "#1976d2" }}>
                {poId} →
              </Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        <h3 style={{ margin: "8px 0" }}>Drafts</h3>
        {drafts.length === 0 && <div style={{ color: "#666" }}>No drafts returned for this backorder.</div>}
        {drafts.map((draft, idx) => (
          <DraftCard key={draft.vendorId || idx} draft={draft} />
        ))}
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <h3 style={{ margin: "8px 0" }}>Skipped</h3>
        {skipped.length === 0 && <div style={{ color: "#666" }}>No skipped backorders.</div>}
        {skipped.map((s, idx) => (
          <div key={s.backorderRequestId || idx} style={{ padding: 8, background: "#f9f9f9", borderRadius: 6, border: "1px solid #eee" }}>
            <div style={{ fontWeight: 600 }}>Backorder: {s.backorderRequestId}</div>
            <div style={{ color: "#555" }}>{s.reason || "No reason provided"}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={handleCreate}
          disabled={creating || drafts.length === 0}
          style={{
            backgroundColor: creating || drafts.length === 0 ? "#ccc" : "#2e7d32",
            color: "#fff",
            border: "none",
            padding: "10px 18px",
            cursor: creating || drafts.length === 0 ? "not-allowed" : "pointer",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          {creating ? "Creating..." : "Create PO(s)"}
        </button>
        {drafts.length === 0 && <div style={{ color: "#666" }}>No drafts available to create.</div>}
      </div>
    </div>
  );
}
