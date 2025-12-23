import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<Product>(`/objects/product/${id}`, {
          token: token || undefined,
          tenantId,
        });
        setProduct(res);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [id, token, tenantId]);

  if (loading) return <div>Loading product...</div>;
  if (error) return <div style={{ padding: 12, background: "#fee", color: "#c00" }}>{error}</div>;
  if (!product) return <div>Product not found</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{product.name || "(no name)"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/products/${id}/edit`}>Edit</Link>
          <Link to="/products">Back to List</Link>
        </div>
      </div>

      <table style={{ maxWidth: 600, borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>ID</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.id}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>SKU</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.sku || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Name</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.name || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Type</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.type || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>UOM</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.uom || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Price</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>
              {product.price !== undefined ? `$${product.price.toFixed(2)}` : ""}
            </td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>
              Preferred Vendor ID
            </th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.preferredVendorId || "(none)"}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Created</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.createdAt || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Updated</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{product.updatedAt || ""}</td>
          </tr>
        </tbody>
      </table>

      <div>
        <Link to={`/inventory?productId=${product.id}`}>View Inventory for this Product</Link>
      </div>
    </div>
  );
}
