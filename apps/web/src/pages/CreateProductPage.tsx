import { useNavigate } from "react-router-dom";
import { ProductForm } from "../components/ProductForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

export default function CreateProductPage() {
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (data: any) => {
    const res = await apiFetch<{ id: string }>("/objects/product", {
      method: "POST",
      token: token || undefined,
      tenantId,
      body: data,
    });
    navigate(`/products/${res.id}`);
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1>Create Product</h1>
      <ProductForm onSubmit={handleSubmit} submitLabel="Create" />
    </div>
  );
}
