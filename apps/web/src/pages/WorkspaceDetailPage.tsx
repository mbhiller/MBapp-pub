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
  defaultViewId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

type ViewMetadata = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
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
  const [viewMetadataMap, setViewMetadataMap] = useState<Record<string, ViewMetadata | null>>({});
  const [viewMetadataErrors, setViewMetadataErrors] = useState<Record<string, string>>({});
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

  // Hydrate metadata for workspace.views[] (tolerate partial failures)
  useEffect(() => {
    const viewIds = (workspace?.views || []).filter((v): v is string => typeof v === "string");
    if (viewIds.length === 0) return;

    const missingIds = viewIds.filter((id) => !(id in viewMetadataMap));
    if (missingIds.length === 0) return;

    let cancelled = false;
    async function loadMetadata() {
      const results = await Promise.allSettled(
        missingIds.map((viewId) =>
          apiFetch<ViewMetadata>(`/views/${encodeURIComponent(viewId)}`, {
            token: token || undefined,
            tenantId,
          }).then((data) => ({ viewId, data }))
        )
      );

      if (cancelled) return;

      setViewMetadataMap((prev) => {
        const next = { ...prev } as Record<string, ViewMetadata | null>;
        results.forEach((res, idx) => {
          const viewId = res.status === "fulfilled" ? res.value.viewId : missingIds[idx];
          next[viewId] = res.status === "fulfilled" ? res.value.data : null;
        });
        return next;
      });

      setViewMetadataErrors((prev) => {
        const next = { ...prev } as Record<string, string>;
        results.forEach((res, idx) => {
          const viewId = res.status === "fulfilled" ? res.value.viewId : missingIds[idx];
          if (res.status === "rejected") {
            next[viewId] = formatError(res.reason);
          }
        });
        return next;
      });
    }

    loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [tenantId, token, workspace?.views]);

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

    // Check for duplicate
    if (currentViews.includes(viewId)) {
      setUpdateError("View already in workspace");
      return;
    }

    setUpdateLoading(true);
    setUpdateError(null);

    try {
      // If workspace has entityType, validate view.entityType compatibility
      if (workspace.entityType) {
        // Ensure we have metadata for this viewId
        if (!(viewId in viewMetadataMap)) {
          try {
            const viewData = await apiFetch<ViewMetadata>(`/views/${encodeURIComponent(viewId)}`, {
              token: token || undefined,
              tenantId,
            });
            setViewMetadataMap((prev) => ({
              ...prev,
              [viewId]: viewData,
            }));
          } catch (fetchErr) {
            setUpdateError(`Failed to load view metadata: ${formatError(fetchErr)}`);
            setUpdateLoading(false);
            return;
          }
        }

        const viewMeta = viewMetadataMap[viewId];
        if (!viewMeta) {
          setUpdateError(`View "${viewId}" not found`);
          setUpdateLoading(false);
          return;
        }

        // Check entityType compatibility
        if (viewMeta.entityType && viewMeta.entityType !== workspace.entityType) {
          setUpdateError(
            `View "${viewId}" has entityType "${viewMeta.entityType}" but workspace expects "${workspace.entityType}"`
          );
          setUpdateLoading(false);
          return;
        }
      }

      // Validation passed; attempt to add view
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

    // If removing the default view, clear defaultViewId client-side
    const isRemovingDefault = workspace.defaultViewId === viewId;

    setUpdateLoading(true);
    setUpdateError(null);
    try {
      const patchBody: any = { views: updatedViews };
      if (isRemovingDefault) {
        patchBody.defaultViewId = null;
      }

      await apiFetch(`/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        token: token || undefined,
        tenantId,
        body: patchBody,
      });
      await fetchWorkspace();
    } catch (err) {
      setUpdateError(formatError(err));
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleSetDefault = async (viewId: string) => {
    if (!id || !workspace) return;

    setUpdateLoading(true);
    setUpdateError(null);
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        token: token || undefined,
        tenantId,
        body: { defaultViewId: viewId },
      });
      await fetchWorkspace();
    } catch (err) {
      setUpdateError(formatError(err));
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleUnsetDefault = async () => {
    if (!id || !workspace) return;

    setUpdateLoading(true);
    setUpdateError(null);
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        token: token || undefined,
        tenantId,
        body: { defaultViewId: null },
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
              <div style={{ marginTop: 8, display: "grid", gap: 12 }}>
                {workspace.views.map((viewId) => {
                  if (typeof viewId !== "string") {
                    return (
                      <div key={JSON.stringify(viewId)} style={{ color: "#999" }}>
                        {JSON.stringify(viewId)} (invalid format)
                      </div>
                    );
                  }

                  const meta = viewMetadataMap[viewId];
                  const viewEntityType = meta?.entityType || workspace.entityType || null;
                  const listRoute = viewEntityType ? getListPageRoute(viewEntityType) : null;
                  const openHref = listRoute
                    ? `${listRoute}?viewId=${encodeURIComponent(viewId)}`
                    : `/views/${encodeURIComponent(viewId)}`;
                  const name = meta?.name || viewId;
                  const description = meta?.description;
                  const error = viewMetadataErrors[viewId];
                  const isDefault = workspace.defaultViewId === viewId;

                  return (
                    <div
                      key={viewId}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        padding: 12,
                        display: "grid",
                        gap: 6,
                        background: isDefault ? "#f0f8ff" : "#fafafa",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>{name}</span>
                            {isDefault && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: "2px 8px",
                                  background: "#08a",
                                  color: "#fff",
                                  borderRadius: 4,
                                }}
                              >
                                DEFAULT
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 12, color: "#666" }}>{viewId}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <Link
                            to={openHref}
                            style={{
                              padding: "6px 12px",
                              background: "#08a",
                              color: "#fff",
                              borderRadius: 4,
                              textDecoration: "none",
                              fontWeight: 600,
                            }}
                          >
                            Open
                          </Link>
                          {isDefault ? (
                            <button
                              onClick={handleUnsetDefault}
                              disabled={updateLoading}
                              style={{
                                padding: "4px 8px",
                                fontSize: 12,
                                background: "#fff",
                                color: "#666",
                                border: "1px solid #ddd",
                                borderRadius: 4,
                                cursor: "pointer",
                              }}
                            >
                              Unset Default
                            </button>
                          ) : (
                            <button
                              onClick={() => handleSetDefault(viewId)}
                              disabled={updateLoading}
                              style={{
                                padding: "4px 8px",
                                fontSize: 12,
                                background: "#e0f0ff",
                                color: "#08a",
                                border: "1px solid #08a",
                                borderRadius: 4,
                                cursor: "pointer",
                              }}
                            >
                              Set Default
                            </button>
                          )}
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
                        </div>
                      </div>
                      {description ? (
                        <div style={{ fontSize: 13, color: "#444" }}>{description}</div>
                      ) : null}
                      <div style={{ fontSize: 12, color: "#666" }}>
                        Entity Type: {viewEntityType || "(unknown)"}
                      </div>
                      {error ? (
                        <div style={{ fontSize: 12, color: "#c00" }}>
                          Metadata error: {error}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
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
