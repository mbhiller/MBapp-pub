import { Link, useNavigate } from "react-router-dom";
import { PurchaseOrderForm, type PurchaseOrderFormValue } from "../components/PurchaseOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

export default function CreatePurchaseOrderPage() {
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (payload: PurchaseOrderFormValue) => {
    const res = await apiFetch<{ id?: string }>("/objects/purchaseOrder", {
      method: "POST",
      token: token || undefined,
      tenantId,
      body: {
        type: "purchaseOrder",
        status: "draft",
        ...payload,
      },
    });
    const newId = res?.id;
    if (!newId) throw new Error("Create succeeded but no id was returned");
    navigate(`/purchase-orders/${newId}`);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Create Purchase Order</h1>
        <Link to="/purchase-orders">Back to list</Link>
      </div>
      <PurchaseOrderForm submitLabel="Create" onSubmit={handleSubmit} />
    </div>
  );
}
