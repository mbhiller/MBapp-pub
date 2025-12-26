import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import LocationPicker from "../components/LocationPicker";

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
  note?: string;
  locationId?: string;
  lot?: string;
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

function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [onHand, setOnHand] = useState<OnHand | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Modal states
  const [showPutawayModal, setShowPutawayModal] = useState(false);
  const [putawayForm, setPutawayForm] = useState({ qty: 0, toLocationId: "", fromLocationId: "", lot: "", note: "" });
  const [putawayLoading, setPutawayLoading] = useState(false);
  const [putawayError, setPutawayError] = useState<string | null>(null);
  
  const [showCycleCountModal, setShowCycleCountModal] = useState(false);
  const [cycleCountForm, setCycleCountForm] = useState({ countedQty: 0, locationId: "", lot: "", note: "" });
  const [cycleCountLoading, setCycleCountLoading] = useState(false);
  const [cycleCountError, setCycleCountError] = useState<string | null>(null);

  const reloadData = async () => {
    if (!id) return;
    try {
      const onHandRes = await apiFetch<OnHand>(`/inventory/${id}/onhand`, {
        token: token || undefined,
        tenantId,
      });
      setOnHand(onHandRes);

      const movementsRes = await apiFetch<MovementsPage>(`/inventory/${id}/movements`, {
        token: token || undefined,
        tenantId,
        query: { limit: 10 },
      });
      setMovements(movementsRes.items || []);
    } catch (err) {
      console.warn("Failed to reload data", err);
    }
  };

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

  const handlePutawaySubmit = async () => {
    setPutawayError(null);
    if (!id) return;
    if (!putawayForm.qty || putawayForm.qty <= 0) {
      setPutawayError("Qty must be greater than 0");
      return;
    }
    if (!putawayForm.toLocationId) {
      setPutawayError("To Location is required");
      return;
    }

    setPutawayLoading(true);
    try {
      await apiFetch(`/inventory/${id}:putaway`, {
        method: "POST",
        token: token || undefined,
        tenantId,
        headers: { "Idempotency-Key": generateIdempotencyKey() },
        body: {
          qty: putawayForm.qty,
          toLocationId: putawayForm.toLocationId,
          ...(putawayForm.fromLocationId && { fromLocationId: putawayForm.fromLocationId }),
          ...(putawayForm.lot && { lot: putawayForm.lot }),
          ...(putawayForm.note && { note: putawayForm.note }),
        },
      });
      setSuccess("Putaway recorded successfully");
      setShowPutawayModal(false);
      setPutawayForm({ qty: 0, toLocationId: "", fromLocationId: "", lot: "", note: "" });
      await reloadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setPutawayError(formatError(err));
    } finally {
      setPutawayLoading(false);
    }
  };

  const handleCycleCountSubmit = async () => {
    setCycleCountError(null);
    if (!id) return;
    if (cycleCountForm.countedQty < 0) {
      setCycleCountError("Counted Qty must be non-negative");
      return;
    }

    setCycleCountLoading(true);
    try {
      await apiFetch(`/inventory/${id}:cycle-count`, {
        method: "POST",
        token: token || undefined,
        tenantId,
        headers: { "Idempotency-Key": generateIdempotencyKey() },
        body: {
          countedQty: cycleCountForm.countedQty,
          ...(cycleCountForm.locationId && { locationId: cycleCountForm.locationId }),
          ...(cycleCountForm.lot && { lot: cycleCountForm.lot }),
          ...(cycleCountForm.note && { note: cycleCountForm.note }),
        },
      });
      setSuccess("Cycle count completed successfully");
      setShowCycleCountModal(false);
      setCycleCountForm({ countedQty: 0, locationId: "", lot: "", note: "" });
      await reloadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setCycleCountError(formatError(err));
    } finally {
      setCycleCountLoading(false);
    }
  };

  if (loading) return <div>Loading inventory item...</div>;
  if (error) return <div style={{ padding: 12, background: "#fee", color: "#c00" }}>{error}</div>;
  if (!item) return <div>Inventory item not found</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {success && (
        <div style={{ padding: 12, background: "#efe", color: "#060", borderRadius: 4 }}>
          {success}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{item.name || item.itemId || "(no name)"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowPutawayModal(true)}>Putaway</button>
          <button onClick={() => setShowCycleCountModal(true)}>Cycle Count</button>
          <Link to="/inventory">Back to List</Link>
        </div>
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
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Product ID</th>
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
                <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>On Hand</th>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{onHand.onHand ?? 0}</td>
              </tr>
              <tr>
                <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Reserved</th>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{onHand.reserved ?? 0}</td>
              </tr>
              <tr>
                <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Committed</th>
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
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Location</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Lot</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Note</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.action || ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.qty ?? ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.locationId || ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.lot || ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.note || ""}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc" }}>{m.createdAt || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Putaway Modal */}
      {showPutawayModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowPutawayModal(false)}
        >
          <div
            style={{
              background: "white",
              padding: 24,
              borderRadius: 8,
              maxWidth: 500,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Putaway</h2>
            {putawayError && (
              <div style={{ padding: 8, background: "#fee", color: "#c00", borderRadius: 4, marginBottom: 12 }}>
                {putawayError}
              </div>
            )}
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4 }}>
                Qty (required):
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={putawayForm.qty || ""}
                  onChange={(e) => setPutawayForm({ ...putawayForm, qty: parseFloat(e.target.value) || 0 })}
                  disabled={putawayLoading}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                To Location (required):
                <LocationPicker
                  value={putawayForm.toLocationId}
                  onChange={(val) => setPutawayForm({ ...putawayForm, toLocationId: val })}
                  disabled={putawayLoading}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                From Location (optional):
                <input
                  type="text"
                  value={putawayForm.fromLocationId}
                  onChange={(e) => setPutawayForm({ ...putawayForm, fromLocationId: e.target.value })}
                  disabled={putawayLoading}
                  placeholder="Source location id (audit trail)"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Lot (optional):
                <input
                  type="text"
                  value={putawayForm.lot}
                  onChange={(e) => setPutawayForm({ ...putawayForm, lot: e.target.value })}
                  disabled={putawayLoading}
                  placeholder="Lot identifier"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Note (optional):
                <textarea
                  value={putawayForm.note}
                  onChange={(e) => setPutawayForm({ ...putawayForm, note: e.target.value })}
                  disabled={putawayLoading}
                  placeholder="Additional notes"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, minHeight: 60 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={handlePutawaySubmit}
                disabled={putawayLoading}
                style={{ flex: 1, padding: 8, background: "#08a", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                {putawayLoading ? "Submitting…" : "Submit Putaway"}
              </button>
              <button
                onClick={() => setShowPutawayModal(false)}
                disabled={putawayLoading}
                style={{ flex: 1, padding: 8, background: "#ccc", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cycle Count Modal */}
      {showCycleCountModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCycleCountModal(false)}
        >
          <div
            style={{
              background: "white",
              padding: 24,
              borderRadius: 8,
              maxWidth: 500,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Cycle Count</h2>
            {cycleCountError && (
              <div style={{ padding: 8, background: "#fee", color: "#c00", borderRadius: 4, marginBottom: 12 }}>
                {cycleCountError}
              </div>
            )}
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4 }}>
                Counted Qty (required):
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cycleCountForm.countedQty || ""}
                  onChange={(e) => setCycleCountForm({ ...cycleCountForm, countedQty: parseFloat(e.target.value) || 0 })}
                  disabled={cycleCountLoading}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Location (optional):
                <LocationPicker
                  value={cycleCountForm.locationId}
                  onChange={(val) => setCycleCountForm({ ...cycleCountForm, locationId: val })}
                  disabled={cycleCountLoading}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Lot (optional):
                <input
                  type="text"
                  value={cycleCountForm.lot}
                  onChange={(e) => setCycleCountForm({ ...cycleCountForm, lot: e.target.value })}
                  disabled={cycleCountLoading}
                  placeholder="Lot identifier"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Note (optional):
                <textarea
                  value={cycleCountForm.note}
                  onChange={(e) => setCycleCountForm({ ...cycleCountForm, note: e.target.value })}
                  disabled={cycleCountLoading}
                  placeholder="Additional notes"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, minHeight: 60 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={handleCycleCountSubmit}
                disabled={cycleCountLoading}
                style={{ flex: 1, padding: 8, background: "#08a", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                {cycleCountLoading ? "Submitting…" : "Submit Cycle Count"}
              </button>
              <button
                onClick={() => setShowCycleCountModal(false)}
                disabled={cycleCountLoading}
                style={{ flex: 1, padding: 8, background: "#ccc", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
