import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type InventoryItem = {
  id: string;
  itemId?: string;
  productId?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
};

type OnHand = {
  itemId?: string;
  onHand?: number;
  reserved?: number;
  committed?: number;
};

type Movement = {
  id: string;
  action?: string;
  qty?: number;
  createdAt?: string;
};

type MovementsPage = { items?: Movement[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [onHand, setOnHand] = useState<OnHand | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const itemRes = await apiFetch<InventoryItem>(`/objects/inventoryItem/${id}`, {
          token: token || undefined,
          tenantId,
        });
        setItem(itemRes);

        // Optionally fetch onHand
        try {
          const onHandRes = await apiFetch<OnHand>(`/inventory/${id}/onhand`, {
            token: token || undefined,
            tenantId,
          });
          setOnHand(onHandRes);
        } catch (err) {
          // OnHand endpoint might not exist or may fail; don't block the page
          console.warn("Failed to fetch onHand", err);
        }

        // Optionally fetch movements
        try {
          const movementsRes = await apiFetch<MovementsPage>(`/inventory/${id}/movements`, {
            token: token || undefined,
            tenantId,
            query: { limit: 10 },
          });
          setMovements(movementsRes.items || []);
        } catch (err) {
          console.warn("Failed to fetch movements", err);
        }
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [id, token, tenantId]);

  if (loading) return <div>Loading inventory item...</div>;
  if (error) return <div style={{ padding: 12, background: "#fee", color: "#c00" }}>{error}</div>;
  if (!item) return <div>Inventory item not found</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{item.name || item.itemId || "(no name)"}</h1>
        <Link to="/inventory">Back to List</Link>
      </div>

      <h2>Details</h2>
      <table style={{ maxWidth: 600, borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>ID</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.id}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Item ID</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.itemId || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>
              Product ID
            </th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.productId || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Name</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.name || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Created</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.createdAt || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Updated</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.updatedAt || ""}</td>
          </tr>
        </tbody>
      </table>

      {onHand && (
        <>
          <h2>On Hand</h2>
          <table style={{ maxWidth: 600, borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>
                  On Hand
                </th>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{onHand.onHand ?? 0}</td>
              </tr>
              <tr>
                <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>
                  Reserved
                </th>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{onHand.reserved ?? 0}</td>
              </tr>
              <tr>
                <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>
                  Committed
                </th>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{onHand.committed ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {movements.length > 0 && (
        <>
          <h2>Recent Movements</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#eee", textAlign: "left" }}>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Action</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Qty</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.action || ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.qty ?? ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.createdAt || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
