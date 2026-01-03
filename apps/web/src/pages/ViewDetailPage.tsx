import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";

type View = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
  filters?: any[];
  columns?: string[];
  createdAt?: string;
  updatedAt?: string;
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function ViewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, tenantId, policy, policyLoading } = useAuth();
  const canEditView = hasPerm(policy, "view:write") && !policyLoading;
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchView = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<View>(`/views/${encodeURIComponent(id)}`, {
          token: token || undefined,
          tenantId,
        });
        setView(result);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    };
    fetchView();
  }, [id, token, tenantId]);

  const handleDelete = async () => {
    if (!id || !view) return;
    if (!window.confirm(`Delete view "${view.name}"?`)) return;

    try {
      await apiFetch(`/views/${encodeURIComponent(id)}`, {
        method: "DELETE",
        token: token || undefined,
        tenantId,
      });
      navigate("/views");
    } catch (err) {
      alert("Delete failed: " + formatError(err));
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <h1>View Not Found</h1>
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
          {error}
        </div>
        <Link to="/views">Back to Views</Link>
      </div>
    );
  }

  if (!view) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <h1>View Not Found</h1>
        <Link to="/views">Back to Views</Link>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{view.name || "View"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {canEditView && <Link to={`/views/${id}/edit`}>Edit</Link>}
          {canEditView && (
            <button
              onClick={handleDelete}
              style={{
                padding: "4px 12px",
                cursor: "pointer",
                background: "#fee",
                border: "1px solid #c00",
                color: "#c00",
                borderRadius: 2,
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, maxWidth: 600 }}>
        <div>
          <strong>ID:</strong> {view.id}
        </div>
        <div>
          <strong>Name:</strong> {view.name || "—"}
        </div>
        <div>
          <strong>Entity Type:</strong> {view.entityType || "—"}
        </div>
        {view.description && (
          <div>
            <strong>Description:</strong>
            <div style={{ marginTop: 4, padding: 8, background: "#f5f5f5", borderRadius: 4 }}>
              {view.description}
            </div>
          </div>
        )}
        {view.columns && view.columns.length > 0 && (
          <div>
            <strong>Columns:</strong>
            <div style={{ marginTop: 4, padding: 8, background: "#f5f5f5", borderRadius: 4 }}>
              {view.columns.join(", ")}
            </div>
          </div>
        )}
        {view.filters && view.filters.length > 0 && (
          <div>
            <strong>Filters:</strong>
            <pre
              style={{
                marginTop: 4,
                padding: 8,
                background: "#f5f5f5",
                borderRadius: 4,
                overflow: "auto",
                fontSize: 12,
              }}
            >
              {JSON.stringify(view.filters, null, 2)}
            </pre>
          </div>
        )}
        <div>
          <strong>Created:</strong>{" "}
          {view.createdAt ? new Date(view.createdAt).toLocaleString() : "—"}
        </div>
        <div>
          <strong>Updated:</strong>{" "}
          {view.updatedAt ? new Date(view.updatedAt).toLocaleString() : "—"}
        </div>
      </div>

      <div>
        <Link to="/views">← Back to Views</Link>
      </div>
    </div>
  );
}
