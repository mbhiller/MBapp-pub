import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ViewForm } from "../components/ViewForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type View = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
  filters?: any[];
  columns?: string[];
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function EditViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, tenantId } = useAuth();
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

  const handleSubmit = async (payload: any) => {
    if (!id) return;

    await apiFetch(`/views/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: payload,
      token: token || undefined,
      tenantId,
    });

    navigate(`/views/${id}`);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error || !view) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <h1>View Not Found</h1>
        {error && (
          <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
            {error}
          </div>
        )}
        <Link to="/views">Back to Views</Link>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1>Edit View</h1>
      <ViewForm initialValue={view} submitLabel="Save Changes" onSubmit={handleSubmit} />
      <div>
        <Link to={`/views/${id}`}>← Cancel</Link>
      </div>
    </div>
  );
}
