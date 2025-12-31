import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PurchaseOrderForm, type PurchaseOrderFormValue, type PurchaseOrderLineInput } from "../components/PurchaseOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { computePatchLinesDiff, PURCHASE_ORDER_PATCHABLE_LINE_FIELDS } from "../lib/patchLinesDiff";
import { formatPatchLinesError } from "../lib/patchLinesErrors";

type PurchaseOrder = PurchaseOrderFormValue & { id: string; status?: string };

export default function EditPurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [originalLines, setOriginalLines] = useState<PurchaseOrderLineInput[]>([]);
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
        if (!cancelled) {
          setOrder(res);
          const orig: PurchaseOrderLineInput[] = Array.isArray(res?.lines)
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

  const handleSubmit = async (payload: PurchaseOrderFormValue) => {
    if (!id) throw new Error("Missing purchase order id");

    // CRITICAL: Use computePatchLinesDiff (NEVER send full line arrays to API)
    // This helper correctly separates id (server) vs cid (client) in patch ops
    const current = Array.isArray(payload?.lines) ? payload.lines : [];
    const ops = computePatchLinesDiff(originalLines, current, PURCHASE_ORDER_PATCHABLE_LINE_FIELDS);

    if (ops.length === 0) {
      // No changes; avoid endpoint call
      navigate(`/purchase-orders/${id}`);
      return;
    }

    try {
      await apiFetch(`/purchasing/po/${id}:patch-lines`, {
        method: "POST",
        token: token || undefined,
        tenantId,
        body: { ops },
      });
      navigate(`/purchase-orders/${id}`);
    } catch (err) {
      // On error: show message but KEEP local edits in UI (don't navigate away or wipe)
      setError(formatPatchLinesError(err, "PO"));
    }
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
