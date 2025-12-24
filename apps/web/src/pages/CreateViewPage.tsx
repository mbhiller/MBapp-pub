import { useNavigate } from "react-router-dom";
import { ViewForm } from "../components/ViewForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

export default function CreateViewPage() {
  const navigate = useNavigate();
  const { token, tenantId } = useAuth();

  const handleSubmit = async (payload: any) => {
    const result = await apiFetch<{ id: string }>("/views", {
      method: "POST",
      body: payload,
      token: token || undefined,
      tenantId,
    });

    if (result?.id) {
      navigate(`/views/${result.id}`);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1>Create View</h1>
      <ViewForm submitLabel="Create View" onSubmit={handleSubmit} />
    </div>
  );
}
