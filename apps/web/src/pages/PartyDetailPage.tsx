import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";

type Party = {
  id: string;
  name?: string;
  kind?: string;
  roles?: string[];
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

export default function PartyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId, policy, policyLoading } = useAuth();

  // Fail-closed permission check
  const canEdit = hasPerm(policy, "party:write") && !policyLoading;

  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const fetchParty = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<Party>(`/objects/party/${id}`, {
          token: token || undefined,
          tenantId,
        });
        if (!cancelled) setParty(res);
      } catch (err) {
        if (!cancelled) setError(formatError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchParty();
    return () => {
      cancelled = true;
    };
  }, [id, tenantId, token]);

  if (!id) return <div>Missing party id</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Party Detail</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && <Link to={`/parties/${id}/edit`}>Edit</Link>}
          <Link to="/parties">Back to list</Link>
        </div>
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ color: "#b00020" }}>{error}</div> : null}

      {party ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div><strong>Name:</strong> {party.name || "—"}</div>
          <div><strong>Kind:</strong> {party.kind || "—"}</div>
          <div><strong>Roles:</strong> {party.roles?.join(", ") || "—"}</div>
          <div><strong>ID:</strong> {party.id}</div>
          {party.createdAt ? <div><strong>Created:</strong> {party.createdAt}</div> : null}
          {party.updatedAt ? <div><strong>Updated:</strong> {party.updatedAt}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
