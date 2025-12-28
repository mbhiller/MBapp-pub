import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SalesOrderForm, type SalesOrderFormValue, type SalesOrderLineInput } from "../components/SalesOrderForm";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

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
          const orig: SalesOrderLineInput[] = Array.isArray(res?.lines)
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

  const handleSubmit = async (payload: SalesOrderFormValue) => {
    if (!id) throw new Error("Missing sales order id");

    // Compute patch ops between originalLines and current form lines
    const origById = new Map<string, SalesOrderLineInput>();
    for (const ln of originalLines) {
      const k = String(ln.id || "").trim();
      if (k) origById.set(k, ln);
    }
    const current = Array.isArray(payload?.lines) ? payload.lines : [];
    const currById = new Map<string, SalesOrderLineInput>();
    for (const ln of current) {
      const k = String(ln.id || "").trim();
      if (k) currById.set(k, ln);
    }

    type PatchLineOp = { op: "upsert" | "remove"; id?: string; cid?: string; patch?: Partial<any> };
    const ops: PatchLineOp[] = [];

    // Removes: any original id missing from current
    for (const [oid] of origById.entries()) {
      if (!currById.has(oid)) {
        ops.push({ op: "remove", id: oid });
      }
    }

    // Upserts: for each current line
    for (const ln of current) {
      const idTrim = String(ln.id || "").trim();
      const inOriginal = idTrim && origById.has(idTrim);
      const base = inOriginal ? origById.get(idTrim)! : undefined;

      // Build patch of changed fields only when updating; otherwise include required fields
      const patch: Record<string, any> = {};
      const fields: Array<keyof SalesOrderLineInput> = ["itemId", "qty", "uom"];
      if (inOriginal && base) {
        for (const f of fields) {
          const before = (base as any)[f];
          const after = (ln as any)[f];
          const changed = String(before ?? "") !== String(after ?? "");
          if (changed) patch[f as string] = after;
        }
      } else {
        // New line: include required fields only (server assigns id)
        patch.itemId = String(ln.itemId || "").trim();
        patch.qty = Number(ln.qty ?? 0);
        if (ln.uom) patch.uom = String(ln.uom).trim();
      }

      // Skip no-op updates
      if (Object.keys(patch).length === 0) continue;

      const op: PatchLineOp = { op: "upsert", patch };
      if (inOriginal) op.id = idTrim; // update existing by id
      ops.push(op);
    }

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
