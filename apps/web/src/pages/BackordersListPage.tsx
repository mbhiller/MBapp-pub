import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { apiFetch } from "../lib/http";
import {
  searchBackorderRequests,
  ignoreBackorderRequest,
  convertBackorderRequest,
  type BackorderRequest,
} from "../lib/backorders";
import {
  suggestPo,
  createPurchaseOrderFromSuggestion,
  type SuggestPoResponse,
} from "../lib/purchasing";
import SuggestPoChooserModal, {
  type PurchaseOrderDraft,
} from "../components/SuggestPoChooserModal";

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function BackordersListPage() {
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"open" | "ignored" | "converted">("open");
  const [vendorFilter, setVendorFilter] = useState("");
  const [items, setItems] = useState<BackorderRequest[]>([]);
  const [vendorNameById, setVendorNameById] = useState<Record<string, string>>({});
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [suggestResult, setSuggestResult] = useState<SuggestPoResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDrafts, setModalDrafts] = useState<PurchaseOrderDraft[]>([]);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const filter: any = { status };
        if (vendorFilter.trim()) filter.preferredVendorId = vendorFilter.trim();

        const res = await searchBackorderRequests(filter, {
          token: token || undefined,
          tenantId,
          limit: 50,
          next: cursor || undefined,
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [status, vendorFilter, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Fetch vendor names for display
  useEffect(() => {
    const preferredVendorIds = Array.from(
      new Set(items.map((bo) => bo.preferredVendorId).filter((v): v is string => Boolean(v)))
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
            const name = res?.name ?? res?.displayName ?? vendorId;
            entries[vendorId] = name;
          } catch {
            entries[vendorId] = vendorId;
          }
        })
      );
      setVendorNameById((prev) => ({ ...prev, ...entries }));
    })();
  }, [items, tenantId, token, vendorNameById]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSelectAll = () => {
    const allSelected = items.every((bo) => selected[bo.id]);
    if (allSelected) {
      setSelected({});
    } else {
      const newSelected: Record<string, boolean> = {};
      items.forEach((bo) => (newSelected[bo.id] = true));
      setSelected(newSelected);
    }
  };

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const handleIgnore = async (id: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await ignoreBackorderRequest(id, { token: token || undefined, tenantId });
      await fetchPage();
    } catch (err) {
      setActionError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkIgnore = async () => {
    if (selectedIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await Promise.all(
        selectedIds.map((id) => ignoreBackorderRequest(id, { token: token || undefined, tenantId }))
      );
      setSelected({});
      await fetchPage();
    } catch (err) {
      setActionError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuggestPo = async () => {
    if (selectedIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    setSuggestResult(null);
    try {
      // Step 1: Convert backorders
      await Promise.all(
        selectedIds.map((id) => convertBackorderRequest(id, { token: token || undefined, tenantId }))
      );

      // Step 2: Suggest PO
      const res = await suggestPo(
        { backorderRequestIds: selectedIds, vendorId: vendorFilter.trim() || undefined },
        { token: token || undefined, tenantId }
      );

      setSuggestResult(res);

      // Step 3: Handle response
      const drafts = res.drafts ?? (res.draft ? [res.draft] : []);
      if (drafts.length === 0) {
        if (res.skipped && res.skipped.length > 0) {
          setActionError(
            `No PO drafts created: all ${res.skipped.length} backorder(s) were skipped (see details below)`
          );
        } else {
          setActionError("No drafts returned from suggest-po");
        }
        // Do NOT clear selection here - let user retry after reviewing skipped reasons
        await fetchPage();
        return;
      }

      // For single draft: create and navigate immediately
      if (drafts.length === 1) {
        const createRes = await createPurchaseOrderFromSuggestion(
          { draft: drafts[0] },
          { token: token || undefined, tenantId }
        );
        const createdId = createRes.id ?? createRes.ids?.[0];
        if (createdId) {
          setSelected({});
          navigate(`/purchase-orders/${createdId}`);
        } else {
          setActionError("PO created but no ID returned");
        }
        return;
      }

      // For multiple drafts: show chooser modal
      setModalDrafts(drafts);
      setModalOpen(true);
    } catch (err) {
      setActionError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const allSelected = items.length > 0 && items.every((bo) => selected[bo.id]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Backorders</h1>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            Status:
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "open" | "ignored" | "converted")}
              style={{ minWidth: 120 }}
            >
              <option value="open">open</option>
              <option value="ignored">ignored</option>
              <option value="converted">converted</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            Preferred Vendor ID:
            <input
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              placeholder="Optional: filter by preferred vendor ID"
              style={{ flex: 1 }}
            />
          </label>
          <button onClick={() => fetchPage()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {selectedIds.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: 8, background: "#e3f2fd", borderRadius: 4 }}>
            <span style={{ fontWeight: 600 }}>{selectedIds.length} selected</span>
            <button onClick={handleBulkIgnore} disabled={actionLoading || selectedIds.length === 0}>
              {actionLoading ? "Ignoring..." : "Bulk Ignore"}
            </button>
            <button onClick={handleSuggestPo} disabled={actionLoading || selectedIds.length === 0}>
              {actionLoading ? "Processing..." : "Suggest PO"}
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div style={{ padding: 12, background: "#fee", color: "#b00020", borderRadius: 4 }}>{error}</div>
      ) : null}

      {actionError ? (
        <div style={{ padding: 12, background: "#fff4e5", color: "#8a3c00", borderRadius: 4 }}>{actionError}</div>
      ) : null}

      {suggestResult?.skipped && suggestResult.skipped.length > 0 && (
        <div style={{ padding: 12, background: "#fff9c4", color: "#6d4c00", borderRadius: 4 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>⚠ Skipped {suggestResult.skipped.length} backorder request(s)</strong>
            <p style={{ margin: "4px 0 0", fontSize: 12, fontStyle: "italic" }}>
              These could not be converted to PO draft. Review reasons below and retry if needed.
            </p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#ffe082" }}>
                  <th style={{ padding: 6, border: "1px solid #fbc02d", textAlign: "left" }}>Backorder ID</th>
                  <th style={{ padding: 6, border: "1px solid #fbc02d", textAlign: "left" }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {suggestResult.skipped.map((s, idx) => (
                  <tr key={idx}>
                    <td style={{ padding: 6, border: "1px solid #fbc02d" }}>{s.backorderRequestId}</td>
                    <td style={{ padding: 6, border: "1px solid #fbc02d" }}>
                      {s.reason || "Unknown reason"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? <div>Loading...</div> : null}
      {!loading && items.length === 0 ? <div>No backorders found.</div> : null}

      {items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#eee" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              </th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Item</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Qty</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>SO</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Status</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Vendor</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((bo) => (
              <tr key={bo.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <input
                    type="checkbox"
                    checked={!!selected[bo.id]}
                    onChange={() => toggleSelect(bo.id)}
                  />
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.itemId ?? "—"}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.qty ?? 0}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {bo.soId ? (
                    <Link to={`/sales-orders/${bo.soId}`}>{bo.soId}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{bo.status ?? "—"}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {bo.preferredVendorId
                    ? vendorNameById[bo.preferredVendorId] ?? bo.preferredVendorId
                    : "Unassigned"}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {bo.status === "open" && (
                    <button
                      onClick={() => handleIgnore(bo.id)}
                      disabled={actionLoading}
                      style={{ fontSize: 12, padding: "4px 8px" }}
                    >
                      Ignore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {next ? (
        <button onClick={() => fetchPage(next)} disabled={loading}>
          {loading ? "Loading..." : "Load more"}
        </button>
      ) : null}

      <SuggestPoChooserModal
        open={modalOpen}
        drafts={modalDrafts}
        onClose={() => {
          setModalOpen(false);
          setModalDrafts([]);
        }}
        onChoose={async (draft) => {
          setModalOpen(false);
          setActionLoading(true);
          setActionError(null);
          try {
            const createRes = await createPurchaseOrderFromSuggestion(
              { draft },
              { token: token || undefined, tenantId }
            );
            const createdId = createRes.id ?? createRes.ids?.[0];
            if (createdId) {
              setSelected({});
              setModalDrafts([]);
              navigate(`/purchase-orders/${createdId}`);
            } else {
              setActionError("PO created but no ID returned");
            }
          } catch (err) {
            setActionError(formatError(err));
          } finally {
            setActionLoading(false);
          }
        }}
        vendorNameById={vendorNameById}
        token={token || undefined}
        tenantId={tenantId}
      />
    </div>
  );
}
