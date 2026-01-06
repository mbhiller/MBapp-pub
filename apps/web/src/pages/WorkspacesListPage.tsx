import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_WORKSPACE_WRITE } from "../generated/permissions";

type Workspace = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
  views?: string[];
  defaultViewId?: string | null;
  updatedAt?: string;
  createdAt?: string;
};

type ViewMetadata = {
  id: string;
  name?: string;
  entityType?: string;
};

type WorkspacePage = { items?: Workspace[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  if (e?.path) parts.push(`path ${e.path}`);
  return parts.join(" · ") || "Request failed";
}

function debugInfo(tenantId: string, apiBase: string, lastFetchStatus?: string | number | null, tenantOverride?: string | null, onSetOverride?: (val: string | null) => void, debugResponse?: { keys: string[]; itemsLength: number } | null): React.ReactNode {
  if (process.env.NODE_ENV !== "development") return null;
  const [overrideInput, setOverrideInput] = useState(tenantOverride || "");

  return (
    <div style={{ padding: 12, marginTop: 16, fontSize: 12, background: "#f5f5f5", borderRadius: 4, color: "#666", fontFamily: "monospace", border: "1px solid #ddd" }}>
      <div><strong>Debug Info (DEV only)</strong></div>
      <div style={{ marginTop: 8 }}>tenant (active): <strong style={{ color: "#000" }}>{tenantId}</strong></div>
      <div>api: {apiBase}</div>
      {lastFetchStatus && <div>last-fetch: {lastFetchStatus}</div>}
      
      {debugResponse && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #ddd" }}>
          <div><strong>Response (last fetch):</strong></div>
          <div>keys: {debugResponse.keys.join(", ")}</div>
          <div>items length: {debugResponse.itemsLength}</div>
        </div>
      )}
      
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #ddd" }}>
        <div style={{ marginBottom: 8 }}><strong>Tenant Override (DEV)</strong></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={overrideInput}
            onChange={(e) => setOverrideInput(e.target.value)}
            placeholder="e.g., SmokeTenant"
            style={{ padding: "4px 8px", fontSize: 12, flex: 1 }}
          />
          <button
            onClick={() => {
              if (overrideInput.trim()) {
                onSetOverride?.(overrideInput.trim());
              }
            }}
            style={{ padding: "4px 8px", fontSize: 12, cursor: "pointer" }}
          >
            Set
          </button>
          <button
            onClick={() => {
              setOverrideInput("");
              onSetOverride?.(null);
            }}
            style={{ padding: "4px 8px", fontSize: 12, cursor: "pointer" }}
          >
            Clear
          </button>
        </div>
        {tenantOverride && <div style={{ marginTop: 8, color: "#d00" }}>override active: {tenantOverride}</div>}
      </div>
    </div>
  );
}

// Helper: map entityType to list page route
function getListPageRoute(entityType?: string): string | null {
  const routes: Record<string, string> = {
    purchaseOrder: "/purchase-orders",
    salesOrder: "/sales-orders",
    inventoryItem: "/inventory",
    party: "/parties",
    event: "/events",
    product: "/products",
    location: "/locations",
  };
  return routes[entityType || ""] || null;
}

const ENTITY_TYPES = [
  "purchaseOrder",
  "salesOrder",
  "inventoryItem",
  "party",
  "account",
  "event",
  "employee",
  "organization",
  "product",
  "class",
  "division",
];

export default function WorkspacesListPage() {
  const navigate = useNavigate();
  const { token, tenantId, policy, policyLoading, apiBase, setTenantOverride, tenantOverride } = useAuth();
  const canCreateWorkspace = hasPerm(policy, PERM_WORKSPACE_WRITE) && !policyLoading;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [lastFetchStatus, setLastFetchStatus] = useState<string | number | null>(null);
  const handleOpen = async (workspace: Workspace) => {
    const viewId = workspace.defaultViewId ?? workspace.views?.[0];

    // No views pinned — navigate to detail
    if (!viewId) {
      navigate(`/workspaces/${workspace.id}`);
      return;
    }

    // If workspace.entityType is set, use it directly
    if (workspace.entityType) {
      const listRoute = getListPageRoute(workspace.entityType);
      if (listRoute) {
        navigate(`${listRoute}?viewId=${encodeURIComponent(viewId)}`);
      } else {
        navigate(`/views/${encodeURIComponent(viewId)}`);
      }
      return;
    }

    // No entityType on workspace — fetch view to determine entityType
    try {
      const view = await apiFetch<ViewMetadata>(`/views/${encodeURIComponent(viewId)}`, {
        token: token || undefined,
        tenantId,
      });

      if (view.entityType) {
        const listRoute = getListPageRoute(view.entityType);
        if (listRoute) {
          navigate(`${listRoute}?viewId=${encodeURIComponent(viewId)}`);
          return;
        }
      }

      // Fallback: navigate to view detail or workspace detail
      navigate(`/views/${encodeURIComponent(viewId)}`);
    } catch (err) {
      console.error("Failed to fetch view:", err);
      // Fallback to workspace detail
      navigate(`/workspaces/${workspace.id}`);
    }
  };

  const [items, setItems] = useState<Workspace[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugResponse, setDebugResponse] = useState<{ keys: string[]; itemsLength: number } | null>(null);

  // Gate debug panel behind explicit debug flag
  const showDebug =
    import.meta.env.DEV &&
    (new URLSearchParams(window.location.search).get("debug") === "1" ||
      import.meta.env.VITE_SHOW_DEV_DEBUG === "true");

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEntityType, setCreateEntityType] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createShared, setCreateShared] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      setLastFetchStatus(null);
      setDebugResponse(null);
      try {
        // Build query params for debug logging
        const queryParams = {
          limit: 20,
          next: cursor ?? undefined,
          q: filter || undefined,
          entityType: entityTypeFilter || undefined,
        };
        
        const res = await apiFetch<WorkspacePage>("/workspaces", {
          token: token || undefined,
          tenantId,
          query: queryParams,
        });
        
        // DEV-only response debugging
        if (process.env.NODE_ENV === "development") {
          console.log("[WorkspacesListPage] GET /workspaces response:", {
            url: `/workspaces?${new URLSearchParams(Object.entries(queryParams).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]) as any).toString()}`,
            responseType: typeof res,
            responseKeys: Object.keys(res),
            itemsLength: (res?.items ?? []).length,
          });
          setDebugResponse({
            keys: Object.keys(res),
            itemsLength: (res?.items ?? []).length,
          });
        }
        
        setLastFetchStatus(200);
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        const errorMsg = formatError(err);
        setError(errorMsg);
        // Extract status from error for debug info
        const status = (err as any)?.status || "error";
        setLastFetchStatus(status);
      } finally {
        setLoading(false);
      }
    },
    [filter, entityTypeFilter, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const onSearch = () => {
    setFilter(search.trim());
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      setCreateError("Name is required");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const payload: any = {
        name: createName.trim(),
        shared: createShared,
      };
      if (createEntityType) payload.entityType = createEntityType;
      if (createDescription.trim()) payload.description = createDescription.trim();

      const result = await apiFetch<Workspace>("/workspaces", {
        method: "POST",
        token: token || undefined,
        tenantId,
        body: payload,
      });

      // Close modal and reset
      setShowCreateModal(false);
      setCreateName("");
      setCreateEntityType("");
      setCreateDescription("");
      setCreateShared(false);

      // Refresh list
      setItems([]);
      setNext(null);
      await fetchPage();

      // Navigate to new workspace detail
      if (result?.id) {
        navigate(`/workspaces/${result.id}`);
      }
    } catch (err) {
      setCreateError(formatError(err));
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Workspaces</h1>
        {canCreateWorkspace && (
          <button onClick={() => setShowCreateModal(true)} style={{ padding: "8px 16px" }}>
            + Create Workspace
          </button>
        )}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            style={{ flex: 1 }}
          />
          <select
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
            style={{ minWidth: 150 }}
          >
            <option value="">All entity types</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button onClick={onSearch} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4, marginBottom: 16 }}>
          <strong>Failed to load workspaces:</strong> {error}
        </div>
      )}

      {loading && items.length === 0 && <div>Loading...</div>}

      {items.length === 0 && !loading && !error && (
        <div style={{ padding: 32, textAlign: "center", color: "#666" }}>
          No workspaces found.
        </div>
      )}

      {items.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: "#eee", textAlign: "left" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Name</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Entity Type</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Views</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Default View</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Updated</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const viewCount = item.views?.length ?? 0;
              const hasDefaultView = !!item.defaultViewId;
              const hasViews = viewCount > 0;
              return (
                <tr key={item.id}>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>
                    <Link to={`/workspaces/${item.id}`}>{item.name || "(no name)"}</Link>
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>
                    {item.entityType || "—"}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc", textAlign: "center" }}>
                    {viewCount}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc", textAlign: "center" }}>
                    {hasDefaultView ? "✓" : "—"}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>
                    {item.updatedAt
                      ? new Date(item.updatedAt).toLocaleDateString()
                      : item.createdAt
                      ? new Date(item.createdAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(hasDefaultView || hasViews) && (
                        <button
                          onClick={() => handleOpen(item)}
                          style={{ padding: "4px 8px", cursor: "pointer" }}
                          title={item.defaultViewId ? "Open default view" : "Open first view"}
                        >
                          Open
                        </button>
                      )}
                      <Link to={`/workspaces/${item.id}`} style={{ padding: "4px 8px" }}>
                        Details
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
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

      {showDebug ? debugInfo(tenantId, apiBase, lastFetchStatus, tenantOverride, setTenantOverride, debugResponse) : null}

      {showCreateModal && (
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
          onClick={() => setShowCreateModal(false)}
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
            <h2>Create Workspace</h2>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                  Name *
                </label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="My Workspace"
                  style={{ width: "100%", padding: 8 }}
                  maxLength={200}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                  Entity Type
                </label>
                <select
                  value={createEntityType}
                  onChange={(e) => setCreateEntityType(e.target.value)}
                  style={{ width: "100%", padding: 8 }}
                >
                  <option value="">-- None --</option>
                  {ENTITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                  Description
                </label>
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Optional description"
                  style={{ width: "100%", padding: 8, minHeight: 80 }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  id="create-shared"
                  checked={createShared}
                  onChange={(e) => setCreateShared(e.target.checked)}
                />
                <label htmlFor="create-shared">Shared</label>
              </div>

              {createError && (
                <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleCreate}
                  disabled={createLoading}
                  style={{ flex: 1, padding: "10px 16px" }}
                >
                  {createLoading ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateName("");
                    setCreateEntityType("");
                    setCreateDescription("");
                    setCreateShared(false);
                    setCreateError(null);
                  }}
                  disabled={createLoading}
                  style={{ padding: "10px 16px" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
