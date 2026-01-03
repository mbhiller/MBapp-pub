import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { SaveViewButton } from "../components/SaveViewButton";
import { ViewSelector } from "../components/ViewSelector";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { mapViewToProductFilters } from "../lib/viewFilterMappers";
import type { ViewConfig } from "../hooks/useViewFilters";

type Product = {
  id: string;
  name?: string;
  sku?: string;
  type?: string;
  uom?: string;
  price?: number;
  preferredVendorId?: string;
};

type ProductPage = { items?: Product[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function ProductsListPage() {
  const [searchParams] = useSearchParams();
  const { token, tenantId, policy, policyLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedView, setAppliedView] = useState<ViewConfig | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const canCreateProduct = hasPerm(policy, "product:write") && !policyLoading;

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<ProductPage>("/objects/product", {
          token: token || undefined,
          tenantId,
          query: {
            limit: 20,
            next: cursor ?? undefined,
            q: filter || undefined,
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
    [filter, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Handle View application: apply mapped filters and refresh the list
  const handleApplyView = useCallback(
    (mappedState: Record<string, any>) => {
      const newQ = mappedState.q !== undefined ? mappedState.q : filter;
      setSearch(newQ);
      setFilter(newQ);
      // fetchPage will be called by useEffect when filter changes
    },
    [filter]
  );

  // Current filter state for View save/overwrite operations
  const currentFilterState = {
    q: filter,
  };

  const onSearch = () => {
    setFilter(search.trim());
  };

  // Initialize from URL params: viewId
  useEffect(() => {
    const urlViewId = searchParams.get("viewId") || "";

    // Handle ?viewId=<id>: fetch and apply the view
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
            const mapped = mapViewToProductFilters(view);
            if (mapped.applied.q !== undefined) {
              setSearch(mapped.applied.q);
              setFilter(mapped.applied.q);
            }
          }
        } catch (err) {
          // Silently fail if view not found; user can select from ViewSelector
        }
      })();
    } else {
      setActiveViewId(null);
    }
  }, [searchParams, token, tenantId]);

  const currentViewFilters = [
    filter.trim() ? { field: "q", op: "contains", value: filter.trim() } : null,
  ].filter(Boolean) as Array<{ field: string; op: string; value: any }>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Products</h1>
        {canCreateProduct && <Link to="/products/new">Create Product</Link>}
      </div>

      <ViewSelector
        entityType="product"
        mapViewToFilterState={mapViewToProductFilters}
        onApplyView={handleApplyView}
        currentFilterState={currentFilterState}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU"
          style={{ flex: 1 }}
        />
        <button onClick={onSearch} disabled={loading}>
          Search
        </button>
        <SaveViewButton
          entityType="product"
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
          No products found. {canCreateProduct && <Link to="/products/new">Create one?</Link>}
        </div>
      )}

      {items.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: "#eee", textAlign: "left" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>SKU</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Name</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Type</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>UOM</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <Link to={`/products/${item.id}`}>{item.sku || "(no sku)"}</Link>
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.name || "(no name)"}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.type || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.uom || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {item.price !== undefined ? `$${item.price.toFixed(2)}` : ""}
                </td>
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
