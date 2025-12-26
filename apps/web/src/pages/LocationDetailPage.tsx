import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import MovementsTable from "../components/MovementsTable";

type Location = {
  id: string;
  name?: string;
  code?: string | null;
  status?: string | null;
  parentId?: string | null;
  notes?: string | null;
  kind?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type Movement = {
  id: string;
  itemId: string;
  action?: string;
  qty?: number;
  createdAt?: string;
  at?: string;
  note?: string;
  lot?: string;
  locationId?: string;
  refId?: string;
  poLineId?: string;
};

type MovementsResponse = {
  items?: Movement[];
  next?: string | null;
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, tenantId } = useAuth();

  const [location, setLocation] = useState<Location | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>("");
  const [refIdFilter, setRefIdFilter] = useState<string>("");
  const [movementsNext, setMovementsNext] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const locRes = await apiFetch<Location>(`/objects/location/${encodeURIComponent(id)}`, {
          token: token || undefined,
          tenantId,
        });
        setLocation(locRes);

        // Fetch movements at this location with filters
        setMovementsError(null);
        try {
          const queryParams: Record<string, any> = { locationId: id, limit: 100 };
          if (actionFilter) queryParams.action = actionFilter;
          if (refIdFilter) queryParams.refId = refIdFilter;

          const mvRes = await apiFetch<MovementsResponse>(`/inventory/movements`, {
            token: token || undefined,
            tenantId,
            query: queryParams,
          });
          setMovements(mvRes.items || []);
          setMovementsNext(mvRes.next || null);
        } catch (err: any) {
          if (err?.status === 404) {
            setMovementsError("Movements endpoint not yet available");
          } else {
            setMovementsError(formatError(err));
          }
        }
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [id, token, tenantId, actionFilter, refIdFilter]);

  const loadMoreMovements = async () => {
    if (!id || !movementsNext) return;
    try {
      const queryParams: Record<string, any> = { locationId: id, limit: 100, next: movementsNext };
      if (actionFilter) queryParams.action = actionFilter;
      if (refIdFilter) queryParams.refId = refIdFilter;

      const mvRes = await apiFetch<MovementsResponse>(`/inventory/movements`, {
        token: token || undefined,
        tenantId,
        query: queryParams,
      });
      setMovements([...movements, ...(mvRes.items || [])]);
      setMovementsNext(mvRes.next || null);
    } catch (err) {
      setMovementsError(formatError(err));
    }
  };

  const clearFilters = () => {
    setActionFilter("");
    setRefIdFilter("");
  };

  if (loading) return <div>Loading location...</div>;
  if (error) return <div style={{ padding: 12, background: "#fee", color: "#c00" }}>{error}</div>;
  if (!location) return <div>Location not found</div>;

  // Derive unique inventory items from movements
  const itemIds = Array.from(new Set(movements.map((m) => m.itemId)));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{location.name || "(no name)"}</h1>
        <Link to="/locations" style={{ color: "#08a", textDecoration: "none" }}>
          Back to Locations
        </Link>
      </div>

      <h2>Details</h2>
      <table style={{ maxWidth: 600, borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>ID</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.id}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Name</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.name || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Code</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.code || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Status</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.status || ""}</td>
          </tr>
          {location.kind && (
            <tr>
              <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Kind</th>
              <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.kind}</td>
            </tr>
          )}
          {location.parentId && (
            <tr>
              <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Parent ID</th>
              <td style={{ padding: 8, border: "1px solid #ccc" }}>
                <Link to={`/locations/${encodeURIComponent(location.parentId)}`} style={{ color: "#08a" }}>
                  {location.parentId}
                </Link>
              </td>
            </tr>
          )}
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Created</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.createdAt || ""}</td>
          </tr>
          <tr>
            <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Updated</th>
            <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.updatedAt || ""}</td>
          </tr>
          {location.notes && (
            <tr>
              <th style={{ padding: 8, textAlign: "left", background: "#eee", border: "1px solid #ccc" }}>Notes</th>
              <td style={{ padding: 8, border: "1px solid #ccc" }}>{location.notes}</td>
            </tr>
          )}
        </tbody>
      </table>

      {movementsError && (
        <div style={{ padding: 12, background: "#fef3cd", color: "#856404", borderRadius: 4 }}>
          <strong>Movements:</strong> {movementsError}
        </div>
      )}

      {!movementsError && movements.length > 0 && (
        <>
          <h2>Recent Movements at This Location</h2>

          {/* Filter Controls */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <div>
              <label htmlFor="actionFilter" style={{ display: "block", marginBottom: 4, fontWeight: "bold", fontSize: 14 }}>
                Action
              </label>
              <select
                id="actionFilter"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                style={{ width: "100%", padding: 8, fontSize: 14 }}
              >
                <option value="">All</option>
                <option value="receive">receive</option>
                <option value="reserve">reserve</option>
                <option value="fulfill">fulfill</option>
                <option value="putaway">putaway</option>
                <option value="cycle_count">cycle_count</option>
                <option value="adjust">adjust</option>
                <option value="return">return</option>
                <option value="damage">damage</option>
              </select>
            </div>

            <div>
              <label htmlFor="refIdFilter" style={{ display: "block", marginBottom: 4, fontWeight: "bold", fontSize: 14 }}>
                Ref ID
              </label>
              <input
                id="refIdFilter"
                type="text"
                placeholder="Filter by ref ID..."
                value={refIdFilter}
                onChange={(e) => setRefIdFilter(e.target.value)}
                style={{ width: "100%", padding: 8, fontSize: 14 }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                onClick={clearFilters}
                style={{
                  width: "100%",
                  padding: 8,
                  fontSize: 14,
                  background: "#f0f0f0",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Clear Filters
              </button>
            </div>
          </div>

          <MovementsTable movements={movements} showItemId={true} emptyText="No movements at this location." />

          {/* Load More Button */}
          {movementsNext && (
            <button
              onClick={loadMoreMovements}
              style={{
                marginTop: 12,
                padding: "8px 16px",
                fontSize: 14,
                background: "#08a",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Load More Movements
            </button>
          )}
        </>
      )}

      {!movementsError && itemIds.length > 0 && (
        <>
          <h2>Inventory Items Seen at This Location</h2>
          <ul style={{ lineHeight: 1.8 }}>
            {itemIds.map((itemId) => (
              <li key={itemId}>
                <Link to={`/inventory/${encodeURIComponent(itemId)}`} style={{ color: "#08a" }}>
                  {itemId}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {!movementsError && movements.length === 0 && (
        <div style={{ color: "#666" }}>No movements recorded at this location.</div>
      )}
    </div>
  );
}
