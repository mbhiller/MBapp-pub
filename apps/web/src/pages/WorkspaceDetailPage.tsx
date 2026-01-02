import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type Workspace = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
  views?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

type ViewMetadata = {
  id: string;
  name?: string;
  entityType?: string;
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
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

// Component: render a single view link with metadata + error handling
function ViewLink({
  viewId,
  token,
  tenantId,
}: {
  viewId: string;
  token?: string;
  tenantId?: string;
}) {
  const [view, setView] = useState<ViewMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchViewMetadata = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<ViewMetadata>(`/views/${encodeURIComponent(viewId)}`, {
          token: token || undefined,
          tenantId,
        });
        if (result) {
          setView(result);
        }
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    };
    fetchViewMetadata();
  }, [viewId, token, tenantId]);

  // If we have view metadata and a valid entityType, render as deep link
  if (view?.entityType && !loading) {
    const listPageRoute = getListPageRoute(view.entityType);
    if (listPageRoute) {
      return (
        <span>
          <Link
            to={`${listPageRoute}?viewId=${encodeURIComponent(viewId)}`}
            style={{ color: "#08a", textDecoration: "none", fontWeight: 500 }}
            title={`Open ${view.name || viewId} in ${view.entityType} list`}
          >
            {view.name || viewId}
          </Link>
          <span style={{ fontSize: 12, color: "#666", marginLeft: 8 }}>
            ({view.entityType})
          </span>
        </span>
      );
    }
  }

  // If loading, show placeholder
  if (loading) {
    return (
      <span style={{ color: "#999" }}>
        {viewId} (loading...)
      </span>
    );
  }

  // If error, show non-blocking error with fallback link to Views page
  if (error) {
    return (
      <span>
        <Link to={`/views/${encodeURIComponent(viewId)}`} style={{ color: "#08a", textDecoration: "none" }}>
          {viewId}
        </Link>
        <span style={{ fontSize: 12, color: "#f77", marginLeft: 8 }}>
          (metadata error: {error})
        </span>
      </span>
    );
  }

  // If no view metadata, render fallback link to Views detail page
  return (
    <span>
      <Link to={`/views/${encodeURIComponent(viewId)}`} style={{ color: "#08a", textDecoration: "none" }}>
        {viewId}
      </Link>
    </span>
  );
}

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Views management state
  const [newViewId, setNewViewId] = useState("");
  const [availableViews, setAvailableViews] = useState<ViewMetadata[]>([]);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const fetchWorkspace = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<Workspace>(`/workspaces/${encodeURIComponent(id)}`, {
        token: token || undefined,
        tenantId,
      });
      setWorkspace(result);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [id, token, tenantId]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  // Load available views when workspace entityType is known
  useEffect(() => {
    if (!workspace?.entityType) return;
    const fetchViews = async () => {
      setViewsLoading(true);
      try {
        const result = await apiFetch<{ items?: ViewMetadata[] }>("/views", {
          token: token || undefined,
          tenantId,
          query: { entityType: workspace.entityType, limit: 100 },
        });
        setAvailableViews(result.items ?? []);
      } catch (err) {
        console.error("Failed to load views:", err);
      } finally {
        setViewsLoading(false);
      }
    };
    fetchViews();
  }, [workspace?.entityType, token, tenantId]);

  const handleDelete = async () => {
    if (!id || !workspace) return;
    if (!window.confirm(`Delete workspace "${workspace.name}"? This cannot be undone.`)) return;

    try {
      await apiFetch(`/workspaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
        token: token || undefined,
        tenantId,
      });
      // Navigate back to list
      window.location.href = "/workspaces";
    } catch (err) {
      alert("Delete failed: " + formatError(err));
    }
  };

  const handleAddView = async () => {
    if (!id || !workspace || !newViewId.trim()) return;
    const viewId = newViewId.trim();
    const currentViews = workspace.views ?? [];
    if (currentViews.includes(viewId)) {
      setUpdateError("View already in workspace");
      return;
    }

    setUpdateLoading(true);
    setUpdateError(null);
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        token: token || undefined,
        tenantId,
        body: { views: [...currentViews, viewId] },
      });
      setNewViewId("");
      await fetchWorkspace();
    } catch (err) {
      setUpdateError(formatError(err));
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleRemoveView = async (viewId: string) => {
    if (!id || !workspace) return;
    if (!window.confirm(`Remove view "${viewId}" from workspace?`)) return;

    const currentViews = workspace.views ?? [];
    const updatedViews = currentViews.filter((v) => v !== viewId);

    setUpdateLoading(true);
    setUpdateError(null);
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        token: token || undefined,
        tenantId,
        body: { views: updatedViews },
      });
      await fetchWorkspace();
    } catch (err) {
      setUpdateError(formatError(err));
    } finally {
      setUpdateLoading(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <h1>Workspace Not Found</h1>
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
          {error}
        </div>
        <Link to="/workspaces">← Back to Workspaces</Link>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <h1>Workspace Not Found</h1>
        <Link to="/workspaces">← Back to Workspaces</Link>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{workspace.name || "Workspace"}</h1>
        <button
          onClick={handleDelete}
          style={{
            padding: "8px 16px",
            background: "#c00",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Delete Workspace
        </button>
      </div>

      <div style={{ display: "grid", gap: 12, maxWidth: 600 }}>
        <div>
          <strong>ID:</strong> {workspace.id}
        </div>
        <div>
          <strong>Name:</strong> {workspace.name || "—"}
        </div>
        {workspace.entityType && (
          <div>
            <strong>Entity Type:</strong> {workspace.entityType}
          </div>
        )}
        {workspace.description && (
          <div>
            <strong>Description:</strong>
            <div style={{ marginTop: 4, padding: 8, background: "#f5f5f5", borderRadius: 4 }}>
              {workspace.description}
            </div>
          </div>
        )}
        {workspace.views && Array.isArray(workspace.views) && (
          <div>
            <strong>Views ({workspace.views.length}):</strong>
            {workspace.views.length === 0 ? (
              <div style={{ marginTop: 4, color: "#666" }}>(none)</div>
            ) : (
              <ul style={{ marginTop: 4, paddingLeft: 20, listStyle: "none" }}>
                {workspace.views.map((viewId) => (
                  typeof viewId === "string" ? (
                    <li key={viewId} style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                      <ViewLink
                        viewId={viewId}
                        token={token || undefined}
                        tenantId={tenantId}
                      />
                      <button
                        onClick={() => handleRemoveView(viewId)}
                        disabled={updateLoading}
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          background: "#fee",
                          color: "#c00",
                          border: "1px solid #fcc",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ) : (
                    <li key={JSON.stringify(viewId)} style={{ marginBottom: 8, color: "#999" }}>
                      {JSON.stringify(viewId)} (invalid format)
                    </li>
                  )
                ))}
              </ul>
            )}

            <div style={{ marginTop: 16, padding: 12, background: "#f9f9f9", borderRadius: 4 }}>
              <strong style={{ display: "block", marginBottom: 8 }}>Add View:</strong>
              {workspace.entityType ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={newViewId}
                    onChange={(e) => setNewViewId(e.target.value)}
                    style={{ flex: 1, minWidth: 200, padding: 8 }}
                    disabled={updateLoading || viewsLoading}
                  >
                    <option value="">-- Select a view --</option>
                    {availableViews
                      .filter((v) => !workspace.views?.includes(v.id))
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name || v.id}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={handleAddView}
                    disabled={!newViewId || updateLoading}
                    style={{ padding: "8px 16px" }}
                  >
                    {updateLoading ? "Adding..." : "Add"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={newViewId}
                    onChange={(e) => setNewViewId(e.target.value)}
                    placeholder="Enter view ID"
                    style={{ flex: 1, minWidth: 200, padding: 8 }}
                    disabled={updateLoading}
                  />
                  <button
                    onClick={handleAddView}
                    disabled={!newViewId || updateLoading}
                    style={{ padding: "8px 16px" }}
                  >
                    {updateLoading ? "Adding..." : "Add"}
                  </button>
                </div>
              )}
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                {workspace.entityType
                  ? `Showing views for entityType: ${workspace.entityType}`
                  : "No entityType set — enter view ID manually"}
              </div>
              {updateError && (
                <div style={{ marginTop: 8, padding: 8, background: "#fee", color: "#c00", borderRadius: 4, fontSize: 14 }}>
                  {updateError}
                </div>
              )}
            </div>
          </div>
        )}
        <div>
          <strong>Created:</strong>{" "}
          {workspace.createdAt ? new Date(workspace.createdAt).toLocaleString() : "—"}
        </div>
        <div>
          <strong>Updated:</strong>{" "}
          {workspace.updatedAt ? new Date(workspace.updatedAt).toLocaleString() : "—"}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Raw Data (v1 debug view):</strong>
        <pre
          style={{
            marginTop: 8,
            padding: 12,
            background: "#f5f5f5",
            borderRadius: 4,
            overflow: "auto",
            fontSize: 12,
            border: "1px solid #ddd",
          }}
        >
          {JSON.stringify(workspace, null, 2)}
        </pre>
      </div>

      <div>
        <Link to="/workspaces">← Back to Workspaces</Link>
      </div>
    </div>
  );
}
