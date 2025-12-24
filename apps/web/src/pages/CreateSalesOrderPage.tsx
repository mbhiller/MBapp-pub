import { Link, useNavigate } from "react-router-dom";
import { SalesOrderForm, type SalesOrderFormValue } from "../components/SalesOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

export default function CreateSalesOrderPage() {
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (payload: SalesOrderFormValue) => {
    const res = await apiFetch<{ id?: string }>("/objects/salesOrder", {
      method: "POST",
      token: token || undefined,
      tenantId,
      body: {
        type: "salesOrder",
        status: "draft",
        ...payload,
      },
    });
    const newId = res?.id;
    if (!newId) throw new Error("Create succeeded but no id was returned");
    navigate(`/sales-orders/${newId}`);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Create Sales Order</h1>
        <Link to="/sales-orders">Back to list</Link>
      </div>
      <SalesOrderForm submitLabel="Create" onSubmit={handleSubmit} />
    </div>
  );
}
