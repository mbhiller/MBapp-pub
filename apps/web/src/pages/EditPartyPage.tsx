import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PartyForm } from "../components/PartyForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type Party = {
  id: string;
  name?: string;
  kind?: string;
  roles?: string[];
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function EditPartyPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();
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

  const handleSubmit = async (payload: { name: string; kind?: string; roles?: string[] }) => {
    if (!id) throw new Error("Missing party id");
    await apiFetch(`/objects/party/${id}`, {
      method: "PUT",
      body: payload,
      token: token || undefined,
      tenantId,
    });
    navigate(`/parties/${id}`);
  };

  if (!id) return <div>Missing party id</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Edit Party</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/parties/${id}`}>Back to detail</Link>
          <Link to="/parties">Back to list</Link>
        </div>
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ color: "#b00020" }}>{error}</div> : null}

      {party ? (
        <PartyForm initialValue={party} submitLabel="Save" onSubmit={handleSubmit} />
      ) : null}
    </div>
  );
}
