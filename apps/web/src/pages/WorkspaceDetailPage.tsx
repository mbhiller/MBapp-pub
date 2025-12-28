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
        <li key={viewId} style={{ marginBottom: 8 }}>
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
        </li>
      );
    }
  }

  // If loading, show placeholder
  if (loading) {
    return (
      <li key={viewId} style={{ marginBottom: 8, color: "#999" }}>
        {viewId} (loading...)
      </li>
    );
  }

  // If error, show non-blocking error with fallback link to Views page
  if (error) {
    return (
      <li key={viewId} style={{ marginBottom: 8 }}>
        <Link to={`/views/${encodeURIComponent(viewId)}`} style={{ color: "#08a", textDecoration: "none" }}>
          {viewId}
        </Link>
        <span style={{ fontSize: 12, color: "#f77", marginLeft: 8 }}>
          (metadata error: {error})
        </span>
      </li>
    );
  }

  // If no view metadata, render fallback link to Views detail page
  return (
    <li key={viewId} style={{ marginBottom: 8 }}>
      <Link to={`/views/${encodeURIComponent(viewId)}`} style={{ color: "#08a", textDecoration: "none" }}>
        {viewId}
      </Link>
    </li>
  );
}

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchWorkspace = async () => {
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
    };
    fetchWorkspace();
  }, [id, token, tenantId]);

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
        <span style={{ fontSize: 14, color: "#666" }}>(Read-only)</span>
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
            <strong>Views:</strong>
            {workspace.views.length === 0 ? (
              <div style={{ marginTop: 4, color: "#666" }}>(none)</div>
            ) : (
              <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                {workspace.views.map((viewId) => (
                  typeof viewId === "string" ? (
                    <ViewLink
                      key={viewId}
                      viewId={viewId}
                      token={token || undefined}
                      tenantId={tenantId}
                    />
                  ) : (
                    <li key={JSON.stringify(viewId)} style={{ marginBottom: 8, color: "#999" }}>
                      {JSON.stringify(viewId)} (invalid format)
                    </li>
                  )
                ))}
              </ul>
            )}
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
