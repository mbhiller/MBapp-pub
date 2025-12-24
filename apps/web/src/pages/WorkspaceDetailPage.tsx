import { useEffect, useState } from "react";
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

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
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
                {workspace.views.map((viewId, idx) => (
                  <li key={idx}>
                    {typeof viewId === "string" ? (
                      <Link to={`/views/${viewId}`}>{viewId}</Link>
                    ) : (
                      JSON.stringify(viewId)
                    )}
                  </li>
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
