import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { ViewSelector } from "../components/ViewSelector";
import { mapViewToSOFilters } from "../lib/viewFilterMappers";
import type { ViewConfig } from "../hooks/useViewFilters";

type SalesOrder = {
  id: string;
  status?: string;
  partyId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type SalesOrderPage = { items?: SalesOrder[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function SalesOrdersListPage() {
  const [searchParams] = useSearchParams();
  const { token, tenantId } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [filter, setFilter] = useState({ q: "", status: "all" });
  const [items, setItems] = useState<SalesOrder[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedView, setAppliedView] = useState<ViewConfig | null>(null);

  const queryParams = useMemo(() => {
    const q: Record<string, string | number | boolean | undefined> = {
      limit: 20,
      q: filter.q || undefined,
    };
    if (filter.status && filter.status !== "all") {
      q["filter.status"] = filter.status;
    }
    return q;
  }, [filter.q, filter.status]);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<SalesOrderPage>("/objects/salesOrder", {
          token: token || undefined,
          tenantId,
          query: {
            ...queryParams,
            next: cursor ?? undefined,
            sort: "desc",
          },
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [queryParams, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Handle View application: apply mapped filters and refresh the list
  const handleApplyView = useCallback(
    (mappedState: Record<string, any>) => {
      const newQ = mappedState.q !== undefined ? mappedState.q : filter.q;
      const newStatus = mappedState.status !== undefined ? mappedState.status : filter.status;
      setSearch(newQ);
      setStatus(newStatus);
      setFilter({ q: newQ, status: newStatus });
      // fetchPage will be called by useEffect when filter changes
    },
    [filter]
  );

  // Current filter state for View save/overwrite operations
  const currentFilterState = {
    q: filter.q,
    status: filter.status,
  };

  const onSearch = () => {
    setFilter({ q: search.trim(), status });
  };

  const onStatusChange = (value: string) => {
    setStatus(value);
    setFilter((prev) => ({ ...prev, status: value }));
  };

  // Initialize from URL params: viewId
  useEffect(() => {
    const urlViewId = searchParams.get("viewId") || "";

    // Handle ?viewId=<id>: fetch and apply the view
    if (urlViewId) {
      (async () => {
        try {
          const view = await apiFetch<ViewConfig>(`/views/${urlViewId}`, {
            token: token || undefined,
            tenantId,
          });
          if (view) {
            setAppliedView(view);
            const mapped = mapViewToSOFilters(view);
            if (mapped.applied.q !== undefined) {
              setSearch(mapped.applied.q);
            }
            if (mapped.applied.status !== undefined) {
              setStatus(mapped.applied.status);
            }
            setFilter((prev) => ({
              q: mapped.applied.q !== undefined ? mapped.applied.q : prev.q,
              status: mapped.applied.status !== undefined ? mapped.applied.status : prev.status,
            }));
          }
        } catch (err) {
          // Silently fail if view not found; user can select from ViewSelector
        }
      })();
    }
  }, [searchParams, token, tenantId]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Sales Orders</h1>
        <Link to="/sales-orders/new">Create Sales Order</Link>
      </div>

      <ViewSelector
        entityType="salesOrder"
        mapViewToFilterState={mapViewToSOFilters}
        onApplyView={handleApplyView}
        currentFilterState={currentFilterState}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by id, party, notes"
          style={{ flex: 1 }}
        />
        <select value={status} onChange={(e) => onStatusChange(e.target.value)} style={{ minWidth: 140 }}>
          <option value="all">All statuses</option>
          <option value="draft">draft</option>
          <option value="submitted">submitted</option>
          <option value="committed">committed</option>
          <option value="partially_fulfilled">partially_fulfilled</option>
          <option value="fulfilled">fulfilled</option>
          <option value="cancelled">cancelled</option>
          <option value="closed">closed</option>
        </select>
        <button onClick={onSearch} disabled={loading}>{loading ? "Searching..." : "Search"}</button>
      </div>

      {error ? <div style={{ padding: 12, background: "#fee", color: "#b00020", borderRadius: 4 }}>{error}</div> : null}
      {loading && items.length === 0 ? <div>Loading...</div> : null}
      {!loading && items.length === 0 ? <div>No sales orders found.</div> : null}

      {items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#eee" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>ID</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Status</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Party</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((so) => (
              <tr key={so.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <Link to={`/sales-orders/${so.id}`}>{so.id}</Link>
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{so.status || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{so.partyId || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{so.createdAt || ""}</td>
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
    </div>
  );
}
