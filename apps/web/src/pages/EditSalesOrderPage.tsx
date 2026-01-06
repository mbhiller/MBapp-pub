import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SalesOrderForm, type SalesOrderFormValue, type SalesOrderLineInput } from "../components/SalesOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { computePatchLinesDiff, SALES_ORDER_PATCHABLE_LINE_FIELDS } from "../lib/patchLinesDiff";
import { formatPatchLinesError } from "../lib/patchLinesErrors";

type SalesOrder = SalesOrderFormValue & { id: string; status?: string };

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
        if (!cancelled) {
          const e = err as any;
          setError(e?.message || "Failed to load order");
        }
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
    const statusLower = String(order?.status || "").toLowerCase();
    const canEdit = statusLower === "draft";

    if (!canEdit) {
      setError("Sales order can only be edited in draft status");
      return;
    }

    // CRITICAL: Use computePatchLinesDiff (NEVER send full line arrays to API)
    // This helper correctly separates id (server) vs cid (client) in patch ops
    const current = Array.isArray(payload?.lines) ? payload.lines : [];
    const ops = computePatchLinesDiff({
      originalLines,
      editedLines: current,
      patchableFields: SALES_ORDER_PATCHABLE_LINE_FIELDS
    });

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
      // On error: show message but KEEP local edits in UI (don't navigate away or wipe)
      setError(formatPatchLinesError(err, "SO"));
    }
  };

  if (!id) return <div>Missing sales order id</div>;

  const statusLower = String(order?.status || "").toLowerCase();
  const canEdit = statusLower === "draft";

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
      {!loading && order && !canEdit ? (
        <div style={{ padding: 12, background: "#fff3cd", color: "#7c5a00", borderRadius: 4 }}>
          Sales order can only be edited while in draft status.
        </div>
      ) : null}

      {order ? (
        <SalesOrderForm initialValue={order} submitLabel="Save" onSubmit={handleSubmit} disabled={!canEdit} />
      ) : null}
    </div>
  );
}
