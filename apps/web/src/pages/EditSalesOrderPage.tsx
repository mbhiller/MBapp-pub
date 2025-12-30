import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SalesOrderForm, type SalesOrderFormValue, type SalesOrderLineInput } from "../components/SalesOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { computePatchLinesDiff, SALES_ORDER_PATCHABLE_LINE_FIELDS } from "../lib/patchLinesDiff";

type SalesOrder = SalesOrderFormValue & { id: string; status?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function EditSalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [originalLines, setOriginalLines] = useState<SalesOrderLineInput[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const fetchOrder = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<SalesOrder>(`/objects/salesOrder/${id}`, {
          token: token || undefined,
          tenantId,
        });
        if (!cancelled) {
          setOrder(res);
          const orig: SalesOrderLineInput[] = Array.isArray(res?.lines)
            ? res.lines.map((ln: any) => ({
                id: String(ln.id || "").trim(),  // Keep server id as-is (no tmp fallback)
                itemId: String(ln.itemId || "").trim(),
                qty: Number(ln.qty ?? 0),
                uom: String(ln.uom || "ea").trim() || "ea",
              }))
            : [];
          setOriginalLines(orig);
        }
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

  const handleSubmit = async (payload: SalesOrderFormValue) => {
    if (!id) throw new Error("Missing sales order id");

    // CRITICAL: Use computePatchLinesDiff (NEVER send full line arrays to API)
    // This helper correctly separates id (server) vs cid (client) in patch ops
    const current = Array.isArray(payload?.lines) ? payload.lines : [];
    const ops = computePatchLinesDiff(originalLines, current, SALES_ORDER_PATCHABLE_LINE_FIELDS);

    if (ops.length === 0) {
      // No changes; avoid endpoint call
      navigate(`/sales-orders/${id}`);
      return;
    }

    try {
      await apiFetch(`/sales/so/${id}:patch-lines`, {
        method: "POST",
        token: token || undefined,
        tenantId,
        body: { ops },
      });
      navigate(`/sales-orders/${id}`);
    } catch (err) {
      setError(formatError(err));
    }
  };

  if (!id) return <div>Missing sales order id</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Edit Sales Order</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/sales-orders/${id}`}>Back to detail</Link>
          <Link to="/sales-orders">Back to list</Link>
        </div>
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ color: "#b00020" }}>{error}</div> : null}

      {order ? (
        <SalesOrderForm initialValue={order} submitLabel="Save" onSubmit={handleSubmit} />
      ) : null}
    </div>
  );
}
