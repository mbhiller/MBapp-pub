import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import LocationPicker from "../components/LocationPicker";
import MovementsTable from "../components/MovementsTable";
import { getOnHandByLocation, adjustInventory, type InventoryOnHandByLocationItem } from "../lib/inventory";
import { listLocations, type Location } from "../lib/locations";

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
  at?: string;
  refId?: string;
  poLineId?: string;
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

function getLastLocationId(): string {
  return localStorage.getItem("mbapp:lastLocationId") || "";
}

function getLastLot(): string {
  return localStorage.getItem("mbapp:lastLot") || "";
}

function saveDefaults(locationId?: string, lot?: string) {
  if (locationId) localStorage.setItem("mbapp:lastLocationId", locationId);
  if (lot) localStorage.setItem("mbapp:lastLot", lot);
}

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId, policy, policyLoading } = useAuth();

  // Fail-closed permission checks
  const canPutaway = hasPerm(policy, "inventory:write") && !policyLoading;
  const canAdjust = hasPerm(policy, "inventory:write") && !policyLoading;
  const canCycleCount = hasPerm(policy, "inventory:adjust") && !policyLoading;

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [onHand, setOnHand] = useState<OnHand | null>(null);
  const [onHandByLocation, setOnHandByLocation] = useState<InventoryOnHandByLocationItem[]>([]);
  const [locationsCache, setLocationsCache] = useState<Record<string, Location>>({});
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
  
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ deltaQty: 0, locationId: "", lot: "", note: "" });
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  
  // Movements filter and pagination
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [locationIdFilter, setLocationIdFilter] = useState<string>("");
  const [refIdFilter, setRefIdFilter] = useState<string>("");
  const [movementsNext, setMovementsNext] = useState<string | null>(null);

  const reloadData = async () => {
    if (!id) return;
    try {
      const onHandRes = await apiFetch<OnHand>(`/inventory/${id}/onhand`, {
        token: token || undefined,
        tenantId,
      });
      setOnHand(onHandRes);

      // Fetch onHand by location
      try {
        const onHandByLoc = await getOnHandByLocation(id, { token: token || undefined, tenantId });
        setOnHandByLocation(onHandByLoc);
      } catch (err) {
        console.warn("Failed to fetch onHandByLocation", err);
      }

      const movementsRes = await apiFetch<MovementsPage>(`/inventory/${id}/movements`, {
        token: token || undefined,
        tenantId,
        query: { limit: 10 },
      });
      setMovements(movementsRes.items || []);
      setMovementsNext(movementsRes.next || null);
    } catch (err) {
      console.warn("Failed to reload data", err);
    }
  };

  const loadMoreMovements = async () => {
    if (!id || !movementsNext) return;
    try {
      const movementsRes = await apiFetch<MovementsPage>(`/inventory/${id}/movements`, {
        token: token || undefined,
        tenantId,
        query: { limit: 10, next: movementsNext },
      });
      setMovements((prev) => [...prev, ...(movementsRes.items || [])]);
      setMovementsNext(movementsRes.next || null);
    } catch (err) {
      console.warn("Failed to load more movements", err);
    }
  };

  const handleOpenPutawayModal = () => {
    setPutawayForm({
      qty: 0,
      toLocationId: getLastLocationId(),
      fromLocationId: "",
      lot: getLastLot(),
      note: "",
    });
    setShowPutawayModal(true);
  };

  const handleOpenCycleCountModal = () => {
    setCycleCountForm({
      countedQty: 0,
      locationId: getLastLocationId(),
      lot: getLastLot(),
      note: "",
    });
    setShowCycleCountModal(true);
  };

  const handleOpenAdjustModal = () => {
    setAdjustForm({
      deltaQty: 0,
      locationId: getLastLocationId(),
      lot: getLastLot(),
      note: "",
    });
    setShowAdjustModal(true);
  };

  // Filter movements client-side
  const filteredMovements = movements.filter((m) => {
    if (actionFilter !== "all" && m.action !== actionFilter) return false;
    if (locationIdFilter && m.locationId !== locationIdFilter) return false;
    if (refIdFilter && m.refId !== refIdFilter) return false;
    return true;
  });

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

        // Fetch onHand by location
        try {
          const onHandByLoc = await getOnHandByLocation(id, { token: token || undefined, tenantId });
          setOnHandByLocation(onHandByLoc);
        } catch (err) {
          console.warn("Failed to fetch onHandByLocation", err);
        }

        // Best-effort fetch locations for name/code resolution
        try {
          const locsRes = await listLocations({ limit: 200 }, { token: token || undefined, tenantId });
          const cache: Record<string, Location> = {};
          (locsRes.items || []).forEach((loc) => {
            if (loc.id) cache[String(loc.id)] = loc;
          });
          setLocationsCache(cache);
        } catch (err) {
          console.warn("Failed to fetch locations", err);
        }

        // Optionally fetch movements
        try {
          const movementsRes = await apiFetch<MovementsPage>(`/inventory/${id}/movements`, {
            token: token || undefined,
            tenantId,
            query: { limit: 10 },
          });
          setMovements(movementsRes.items || []);
          setMovementsNext(movementsRes.next || null);
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
      saveDefaults(putawayForm.toLocationId, putawayForm.lot);
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
      saveDefaults(cycleCountForm.locationId, cycleCountForm.lot);
      setCycleCountForm({ countedQty: 0, locationId: "", lot: "", note: "" });
      await reloadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setCycleCountError(formatError(err));
    } finally {
      setCycleCountLoading(false);
    }
  };

  const handleAdjustSubmit = async () => {
    setAdjustError(null);
    if (!id) return;
    if (!isFinite(adjustForm.deltaQty) || adjustForm.deltaQty === 0) {
      setAdjustError("Delta Qty must be a non-zero number");
      return;
    }

    setAdjustLoading(true);
    try {
      await adjustInventory(
        id,
        {
          deltaQty: adjustForm.deltaQty,
          ...(adjustForm.locationId && { locationId: adjustForm.locationId }),
          ...(adjustForm.lot && { lot: adjustForm.lot }),
          ...(adjustForm.note && { note: adjustForm.note }),
        },
        { token: token || undefined, tenantId }
      );
      setSuccess("Inventory adjusted successfully");
      setShowAdjustModal(false);
      saveDefaults(adjustForm.locationId, adjustForm.lot);
      setAdjustForm({ deltaQty: 0, locationId: "", lot: "", note: "" });
      await reloadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setAdjustError(formatError(err));
    } finally {
      setAdjustLoading(false);
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
          {canPutaway && <button onClick={handleOpenPutawayModal}>Putaway</button>}
          {canCycleCount && <button onClick={handleOpenCycleCountModal}>Cycle Count</button>}
          {canAdjust && <button onClick={handleOpenAdjustModal}>Adjust</button>}
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

      {onHandByLocation.length > 0 && (
        <>
          <h2>OnHand by Location</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#eee", textAlign: "left" }}>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Location</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>On Hand</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Reserved</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>Available</th>
                <th style={{ padding: 8, border: "1px solid #ccc" }}>As Of</th>
              </tr>
            </thead>
            <tbody>
              {onHandByLocation.map((item, idx) => {
                const locId = item.locationId;
                let locName = "(unassigned)";
                if (locId) {
                  const cached = locationsCache[locId];
                  if (cached) {
                    locName = String(cached.name || cached.displayName || cached.label || cached.id || locId);
                  } else {
                    locName = String(locId);
                  }
                }
                return (
                  <tr key={idx}>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{locName}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.onHand}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.reserved}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{item.available}</td>
                    <td style={{ padding: 8, border: "1px solid #ccc" }}>{new Date(item.asOf).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h2>Movements</h2>
      <p style={{ marginBottom: 16, fontSize: 14, color: "#666" }}>
        Showing recent movements for this item. To explore movements by location, 
        <Link to={`/inventory-movements?locationId=...`} style={{ color: "#08a", marginLeft: 4, marginRight: 4 }}>view all movements by location</Link>
        (select a location from the OnHand by Location table above).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: "bold", fontSize: 12 }}>Action</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ padding: 6, border: "1px solid #ccc", borderRadius: 4 }}
          >
            <option value="all">All</option>
            <option value="receive">receive</option>
            <option value="reserve">reserve</option>
            <option value="commit">commit</option>
            <option value="fulfill">fulfill</option>
            <option value="adjust">adjust</option>
            <option value="release">release</option>
            <option value="putaway">putaway</option>
            <option value="cycle_count">cycle_count</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: "bold", fontSize: 12 }}>Location ID</span>
          <input
            type="text"
            value={locationIdFilter}
            onChange={(e) => setLocationIdFilter(e.target.value)}
            placeholder="Filter by location id"
            style={{ padding: 6, border: "1px solid #ccc", borderRadius: 4 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: "bold", fontSize: 12 }}>Ref ID</span>
          <input
            type="text"
            value={refIdFilter}
            onChange={(e) => setRefIdFilter(e.target.value)}
            placeholder="Filter by ref id"
            style={{ padding: 6, border: "1px solid #ccc", borderRadius: 4 }}
          />
        </label>
        <div style={{ display: "grid", gap: 4, alignSelf: "end" }}>
          <button
            onClick={() => {
              setActionFilter("all");
              setLocationIdFilter("");
              setRefIdFilter("");
            }}
            style={{ padding: 6, background: "#ddd", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      <MovementsTable movements={filteredMovements} showItemId={false} emptyText="No movements found." />

      {movementsNext && (
        <button
          onClick={loadMoreMovements}
          style={{ padding: 8, background: "#08a", color: "white", border: "none", borderRadius: 4, cursor: "pointer", marginBottom: 16 }}
        >
          Load More Movements
        </button>
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
                <LocationPicker
                  value={putawayForm.fromLocationId}
                  onChange={(val) => setPutawayForm({ ...putawayForm, fromLocationId: val })}
                  disabled={putawayLoading}
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

      {/* Adjust Modal */}
      {showAdjustModal && (
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
          onClick={() => setShowAdjustModal(false)}
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
            <h2>Adjust Inventory</h2>
            {adjustError && (
              <div style={{ padding: 8, background: "#fee", color: "#c00", borderRadius: 4, marginBottom: 12 }}>
                {adjustError}
              </div>
            )}
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4 }}>
                Delta Qty (required, + or -):
                <input
                  type="number"
                  step="0.01"
                  value={adjustForm.deltaQty || ""}
                  onChange={(e) => setAdjustForm({ ...adjustForm, deltaQty: parseFloat(e.target.value) || 0 })}
                  disabled={adjustLoading}
                  placeholder="e.g., 10 or -5"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
                <small style={{ color: "#666" }}>Positive to add, negative to subtract</small>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Location (optional):
                <LocationPicker
                  value={adjustForm.locationId}
                  onChange={(val) => setAdjustForm({ ...adjustForm, locationId: val })}
                  disabled={adjustLoading}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Lot (optional):
                <input
                  type="text"
                  value={adjustForm.lot}
                  onChange={(e) => setAdjustForm({ ...adjustForm, lot: e.target.value })}
                  disabled={adjustLoading}
                  placeholder="Lot identifier"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Note (optional):
                <textarea
                  value={adjustForm.note}
                  onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })}
                  disabled={adjustLoading}
                  placeholder="Reason for adjustment"
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, minHeight: 60 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={handleAdjustSubmit}
                disabled={adjustLoading}
                style={{ flex: 1, padding: 8, background: "#08a", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                {adjustLoading ? "Submitting…" : "Submit Adjustment"}
              </button>
              <button
                onClick={() => setShowAdjustModal(false)}
                disabled={adjustLoading}
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
