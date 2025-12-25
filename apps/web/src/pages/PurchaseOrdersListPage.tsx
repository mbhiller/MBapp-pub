import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type PurchaseOrder = {
  id: string;
  status?: string;
  vendorId?: string;
  vendorName?: string;
  orderNumber?: string;
  created?: string;
  updated?: string;
};

type PurchaseOrderPage = { items?: PurchaseOrder[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function PurchaseOrdersListPage() {
  const [searchParams] = useSearchParams();
  const { token, tenantId } = useAuth();
  const [items, setItems] = useState<PurchaseOrder[]>([]);
  const [vendorNameById, setVendorNameById] = useState<Record<string, string>>({});
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [vendorMode, setVendorMode] = useState<boolean>(false);
  const [vendorIdLocked, setVendorIdLocked] = useState<boolean>(false);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const query: Record<string, string | number | undefined> = {
          limit: 50,
          next: cursor ?? undefined,
          sort: "desc",
        };
        if (statusFilter) query["filter.status"] = statusFilter;
        if (vendorFilter.trim()) query["filter.vendorId"] = vendorFilter.trim();

        const res = await apiFetch<PurchaseOrderPage>("/objects/purchaseOrder", {
          token: token || undefined,
          tenantId,
          query,
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [tenantId, token, statusFilter, vendorFilter, vendorMode]
  );

  // Initialize from URL params: vendorId and vendorMode
  useEffect(() => {
    const urlVendor = searchParams.get("vendorId") || "";
    const urlVendorModeRaw = searchParams.get("vendorMode") || "";
    const urlVendorMode = urlVendorModeRaw === "1" || urlVendorModeRaw.toLowerCase() === "true";
    if (urlVendor) {
      setVendorFilter(urlVendor);
      setVendorIdLocked(true);
    }
    if (urlVendorMode) setVendorMode(true);
  }, [searchParams]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Fetch vendor names for display
  useEffect(() => {
    const vendorIds = Array.from(
      new Set(items.map((po) => po.vendorId).filter((v): v is string => Boolean(v)))
    );

    const missing = vendorIds.filter((v) => !(v in vendorNameById));
    if (missing.length === 0) return;

    (async () => {
      const entries: Record<string, string> = {};
      await Promise.all(
        missing.map(async (vendorId) => {
          try {
            const res = await apiFetch<{ name?: string; displayName?: string }>(
              `/objects/party/${vendorId}`,
              { token: token || undefined, tenantId }
            );
            entries[vendorId] = res?.name ?? res?.displayName ?? vendorId;
          } catch {
            entries[vendorId] = vendorId;
          }
        })
      );
      setVendorNameById((prev) => ({ ...prev, ...entries }));
    })();
  }, [items, tenantId, token, vendorNameById]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Purchase Orders</h1>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Status:
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">All</option>
            <option value="draft">draft</option>
            <option value="submitted">submitted</option>
            <option value="approved">approved</option>
            <option value="partially_fulfilled">partially_fulfilled</option>
            <option value="fulfilled">fulfilled</option>
            <option value="closed">closed</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
          Vendor ID:
          <input
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            placeholder="Optional: filter by vendor ID"
            style={{ flex: 1 }}
            disabled={vendorMode && vendorIdLocked}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={vendorMode}
            onChange={(e) => {
              setVendorMode(e.target.checked);
              if (!e.target.checked) setVendorIdLocked(false);
            }}
          />
          Vendor Portal mode
        </label>
        <button
          onClick={() => {
            setStatusFilter("");
            setVendorFilter("");
            setVendorMode(false);
            setVendorIdLocked(false);
            fetchPage();
          }}
          disabled={loading}
        >
          Clear filters
        </button>
      </div>

      {vendorMode && (
        <div style={{ fontSize: 13, color: vendorFilter.trim() ? "#444" : "#b3261e" }}>
          {vendorFilter.trim()
            ? "Showing POs for this vendor only."
            : "Vendor Portal mode requires a vendorId."}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
          {error}
        </div>
      )}

      {loading && items.length === 0 && <div>Loading...</div>}

      {items.length === 0 && !loading && (
        <div style={{ padding: 32, textAlign: "center", color: "#666" }}>
          No purchase orders found.
        </div>
      )}

      {items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#eee" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>ID</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Status</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Vendor</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((po) => (
              <tr key={po.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <Link to={`/purchase-orders/${po.id}`}>{po.id}</Link>
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {po.status ?? "—"}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {po.vendorId
                    ? vendorNameById[po.vendorId] ?? po.vendorId
                    : "Unassigned"}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {po.updated ?? po.created ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {next && (
        <button onClick={() => fetchPage(next)} disabled={loading}>
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
