import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PurchaseOrderForm, type PurchaseOrderFormValue } from "../components/PurchaseOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type PurchaseOrder = PurchaseOrderFormValue & { id: string; status?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function EditPurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const fetchOrder = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<PurchaseOrder>(`/objects/purchaseOrder/${id}`, {
          token: token || undefined,
          tenantId,
        });
        if (!cancelled) setOrder(res);
      } catch (err) {
        if (!cancelled) setError(formatError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchOrder();
    return () => {
      cancelled = true;
    };
  }, [id, tenantId, token]);

  const handleSubmit = async (payload: PurchaseOrderFormValue) => {
    if (!id) throw new Error("Missing purchase order id");
    await apiFetch(`/objects/purchaseOrder/${id}`, {
      method: "PUT",
      token: token || undefined,
      tenantId,
      body: payload,
    });
    navigate(`/purchase-orders/${id}`);
  };

  if (!id) return <div>Missing purchase order id</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Edit Purchase Order</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/purchase-orders/${id}`}>Back to detail</Link>
          <Link to="/purchase-orders">Back to list</Link>
        </div>
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ color: "#b00020" }}>{error}</div> : null}

      {order ? (
        <PurchaseOrderForm initialValue={order} submitLabel="Save" onSubmit={handleSubmit} />
      ) : null}
    </div>
  );
}
