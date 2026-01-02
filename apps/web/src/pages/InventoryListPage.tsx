import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { SaveViewButton } from "../components/SaveViewButton";
import { ViewSelector } from "../components/ViewSelector";
import { useAuth } from "../providers/AuthProvider";
import { mapViewToInventoryFilters } from "../lib/viewFilterMappers";
import type { ViewConfig } from "../hooks/useViewFilters";

type InventoryItem = {
  id: string;
  itemId?: string;
  productId?: string;
  name?: string;
};

type InventoryPage = { items?: InventoryItem[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function InventoryListPage() {
  const { token, tenantId } = useAuth();
  const [searchParams] = useSearchParams();
  const initialProductId = searchParams.get("productId") || "";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [productIdFilter, setProductIdFilter] = useState(initialProductId);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedView, setAppliedView] = useState<ViewConfig | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<InventoryPage>("/objects/inventoryItem", {
          token: token || undefined,
          tenantId,
          query: {
            limit: 20,
            next: cursor ?? undefined,
            q: filter || undefined,
            productId: productIdFilter || undefined,
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
    [filter, productIdFilter, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const onSearch = () => {
    setFilter(search.trim());
  };

  // Handle View application: apply mapped filters and refresh the list
  const handleApplyView = useCallback(
    (mappedState: Record<string, any>) => {
      if (mappedState.q !== undefined) {
        const newQ = mappedState.q ?? "";
        setSearch(newQ);
        setFilter(newQ);
      }
      if (mappedState.productId !== undefined) {
        setProductIdFilter(mappedState.productId ?? "");
      }
    },
    []
  );

  // Current filter state for View save/overwrite operations
  const currentFilterState = {
    q: filter,
    productId: productIdFilter,
  };

  // Initialize from URL params: viewId and productId
  useEffect(() => {
    const urlViewId = searchParams.get("viewId") || "";
    const urlProductId = searchParams.get("productId") || "";

    if (urlProductId) {
      setProductIdFilter(urlProductId);
    }

    if (urlViewId) {
      setActiveViewId(urlViewId);
      (async () => {
        try {
          const view = await apiFetch<ViewConfig>(`/views/${urlViewId}`, {
            token: token || undefined,
            tenantId,
          });
          if (view) {
            setAppliedView(view);
            const mapped = mapViewToInventoryFilters(view);
            if (mapped.applied.q !== undefined) {
              const newQ = mapped.applied.q ?? "";
              setSearch(newQ);
              setFilter(newQ);
            }
            if (mapped.applied.productId !== undefined) {
              setProductIdFilter(mapped.applied.productId ?? "");
            }
          }
        } catch {
          // Silently ignore missing/unauthorized view
        }
      })();
    } else {
      setActiveViewId(null);
    }
  }, [searchParams, tenantId, token]);

  const currentViewFilters = [
    filter.trim() ? { field: "q", op: "contains", value: filter.trim() } : null,
    productIdFilter ? { field: "productId", op: "eq", value: productIdFilter } : null,
  ].filter(Boolean) as Array<{ field: string; op: string; value: any }>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Inventory</h1>
        {productIdFilter && (
          <div style={{ fontSize: 14, color: "#666" }}>
            Filtered by productId: {productIdFilter}
          </div>
        )}
      </div>

      <ViewSelector
        entityType="inventoryItem"
        mapViewToFilterState={mapViewToInventoryFilters}
        onApplyView={handleApplyView}
        currentFilterState={currentFilterState}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by itemId or productId"
          style={{ flex: 1 }}
        />
        <button onClick={onSearch} disabled={loading}>
          Search
        </button>
        <SaveViewButton
          entityType="inventoryItem"
          filters={currentViewFilters}
          buttonLabel="Save as View"
          activeViewId={activeViewId || undefined}
          activeViewName={appliedView?.name}
        />
      </div>

      {error && (
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
          {error}
        </div>
      )}

      {loading && items.length === 0 && <div>Loading...</div>}

      {items.length === 0 && !loading && (
        <div style={{ padding: 32, textAlign: "center", color: "#666" }}>
          No inventory items found.
        </div>
      )}

      {items.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: "#eee", textAlign: "left" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Item ID</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Product ID</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Name</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <Link to={`/inventory/${item.id}`}>{item.itemId || item.id}</Link>
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.productId || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.name || "(no name)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {next && (
        <div>
          <button onClick={() => fetchPage(next)} disabled={loading}>
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
