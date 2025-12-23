import { useNavigate, Link } from "react-router-dom";
import { PartyForm } from "../components/PartyForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type PartyCreateResponse = { id?: string };

export default function CreatePartyPage() {
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (payload: { name: string; kind?: string; roles?: string[] }) => {
    const res = await apiFetch<PartyCreateResponse>("/objects/party", {
      method: "POST",
      body: payload,
      token: token || undefined,
      tenantId,
    });
    const newId = res?.id;
    if (!newId) {
      throw new Error("Create succeeded but no id was returned");
    }
    navigate(`/parties/${newId}`);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Create Party</h1>
        <Link to="/parties">Back to list</Link>
      </div>
      <PartyForm submitLabel="Create" onSubmit={handleSubmit} />
    </div>
  );
}
