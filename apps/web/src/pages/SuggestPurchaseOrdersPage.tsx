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

function humanizeReason(reason?: string): string {
  const map: Record<string, string> = {
    no_preferred_vendor: "No preferred vendor set",
    no_vendor: "No vendor available",
    missing_vendor: "No vendor available",
    already_converted: "Already converted to PO",
    already_fulfilled: "Already fulfilled",
    invalid_backorder: "Invalid backorder request",
    unsupported_item: "Item not eligible for purchase",
    not_found: "Backorder not found",
    ignored: "Backorder is ignored",
    zero_qty: "Quantity is zero",
    missing_item: "Backorder missing item",
  };
  if (!reason) return "No reason provided";
  const key = reason.toString().toLowerCase();
  return map[key] || reason.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function DraftCard({ draft }: { draft: PurchaseOrderDraft }) {
  const lines = draft.lines || [];
  const vendorLabel = draft.vendorName || draft.vendorId || "(unknown)";
  const vendorIdLabel = draft.vendorId ? ` · ${draft.vendorId}` : "";
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Vendor: {vendorLabel}{vendorIdLabel}</div>
        {draft.status && <div style={{ fontSize: 12, color: "#666" }}>Status: {draft.status}</div>}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {lines.length === 0 && <div style={{ color: "#666" }}>No lines suggested.</div>}
        {lines.map((ln, idx) => (
          <div
            key={ln.id || ln.lineId || `${ln.itemId || "line"}-${idx}`}
            style={{ padding: 8, border: "1px solid #eee", borderRadius: 6, background: "#fafafa" }}
          >
            {/** Use best-effort fields to highlight MOQ bumps and notes */}
            {(() => {
              const requested = ln.qtyRequested ?? ln.qty ?? 0;
              const suggested = ln.qtySuggested ?? ln.qty ?? 0;
              const lineNote = (ln as any)?.note ?? (ln as any)?.notes ?? (ln as any)?.noteText;
              return (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 600 }}>{ln.itemId || ln.productId || "(unknown item)"}</div>
                <div>
                  <span style={{ fontWeight: 600 }}>{suggested || "—"}</span>
                  {ln.uom ? ` ${ln.uom}` : ""}
                  {ln.qtyRequested != null && suggested !== requested ? (
                    <span style={{ marginLeft: 6, color: "#d32f2f" }}>
                      (requested {requested})
                    </span>
                  ) : null}
                </div>
              </div>
              {(ln.minOrderQtyApplied != null || ln.adjustedFrom != null || (ln.qtyRequested != null && suggested !== requested)) && (
                <div style={{ fontSize: 12, color: "#555" }}>
                  MOQ applied: {ln.minOrderQtyApplied ?? "—"}
                  {ln.adjustedFrom != null ? ` · adjusted from ${ln.adjustedFrom}` : ""}
                  {ln.qtyRequested != null && suggested !== requested ? " · bumped due to MOQ" : ""}
                </div>
              )}
              {lineNote ? (
                <div style={{ fontSize: 12, color: "#555" }}>Note: {lineNote}</div>
              ) : null}
              {ln.backorderRequestIds?.length ? (
                <div style={{ fontSize: 12, color: "#555", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span>Backorders ({ln.backorderRequestIds.length}):</span>
                  {ln.backorderRequestIds.map((boId) => (
                    <Link key={boId} to={`/backorders/${boId}`} style={{ color: "#1976d2" }}>
                      {boId} →
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
              );
            })()}
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
      const results = await Promise.all(
        drafts.map((draft) => createPurchaseOrdersFromSuggestion(draft, { token, tenantId }))
      );
      const ids: string[] = [];
      results.forEach((res) => {
        const created = Array.isArray(res?.ids) ? res?.ids : res?.id ? [res.id] : [];
        ids.push(...created);
      });
      setCreatedIds(ids);
      if (ids.length === 0) {
        setActionError("No purchase orders were created.");
      } else {
        navigate(`/purchase-orders/${encodeURIComponent(ids[0])}`);
      }
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
          <div key={draft.vendorId || idx} style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{draft.vendorName || draft.vendorId || "Vendor"}</div>
              {draft.vendorId && (
                <span style={{ fontSize: 12, color: "#555" }}>({draft.vendorId})</span>
              )}
            </div>
            <DraftCard draft={draft} />
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <h3 style={{ margin: "8px 0" }}>Skipped</h3>
        {skipped.length === 0 && <div style={{ color: "#666" }}>No skipped backorders.</div>}
        {skipped.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#fff5f5" }}>
                  <th style={{ padding: 8, border: "1px solid #ffcdd2", textAlign: "left" }}>Backorder ID</th>
                  <th style={{ padding: 8, border: "1px solid #ffcdd2", textAlign: "left" }}>Reason (code)</th>
                  <th style={{ padding: 8, border: "1px solid #ffcdd2", textAlign: "left" }}>Reason (friendly)</th>
                </tr>
              </thead>
              <tbody>
                {skipped.map((s, idx) => (
                  <tr key={s.backorderRequestId || idx}>
                    <td style={{ padding: 8, border: "1px solid #ffcdd2" }}>
                      {s.backorderRequestId ? (
                        <Link to={`/backorders/${s.backorderRequestId}`} style={{ color: "#d32f2f" }}>
                          {s.backorderRequestId} →
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: 8, border: "1px solid #ffcdd2" }}>{s.reason || "—"}</td>
                    <td style={{ padding: 8, border: "1px solid #ffcdd2" }}>{humanizeReason(s.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
