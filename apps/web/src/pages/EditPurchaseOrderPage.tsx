import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PurchaseOrderForm, type PurchaseOrderFormValue, type PurchaseOrderLineInput } from "../components/PurchaseOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { computePatchLinesDiff } from "../lib/patchLinesDiff";

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
          const makeLineId = () => {
            try {
              // Prefer crypto.randomUUID for stable unique ids
              if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
                return `tmp-${(crypto as any).randomUUID()}`;
              }
            } catch {}
            // Fallback if randomUUID is unavailable
            return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          };
          const orig: PurchaseOrderLineInput[] = Array.isArray(res?.lines)
            ? res.lines.map((ln: any) => ({
                id: String(ln.id || "").trim() || makeLineId(),
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

  const handleSubmit = async (payload: PurchaseOrderFormValue) => {
    if (!id) throw new Error("Missing purchase order id");

    // Compute patch ops using shared helper
    const current = Array.isArray(payload?.lines) ? payload.lines : [];
    const ops = computePatchLinesDiff(originalLines, current, ["itemId", "qty", "uom"]);

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
      const e = err as any;
      // Handle PO_NOT_EDITABLE or status guard failures with clear message
      if (e?.code === "PO_NOT_EDITABLE" || e?.status === 409 || e?.status === 400) {
        const msg = e?.message || "Purchase order cannot be edited in current status (only draft can be patched)";
        setError(msg);
      } else {
        setError(formatError(err));
      }
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
