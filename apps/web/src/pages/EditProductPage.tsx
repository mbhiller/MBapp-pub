import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ProductForm } from "../components/ProductForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type Product = {
  id: string;
  name?: string;
  sku?: string;
  type?: string;
  uom?: string;
  price?: number;
  preferredVendorId?: string;
};

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      setLoading(true);
      try {
        const res = await apiFetch<Product>(`/objects/product/${id}`, {
          token: token || undefined,
          tenantId,
        });
        setProduct(res);
      } catch (err) {
        console.error("Failed to load product", err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [id, token, tenantId]);

  const handleSubmit = async (data: any) => {
    await apiFetch(`/objects/product/${id}`, {
      method: "PUT",
      token: token || undefined,
      tenantId,
      body: data,
    });
    navigate(`/products/${id}`);
  };

  if (loading) return <div>Loading...</div>;
  if (!product) return <div>Product not found</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1>Edit Product</h1>
      <ProductForm initialValue={product} onSubmit={handleSubmit} submitLabel="Update" />
    </div>
  );
}
