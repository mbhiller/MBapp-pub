import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import MovementsTable, { type MovementRow } from "../components/MovementsTable";

type MovementsResponse = {
  items?: MovementRow[];
  next?: string;
};

export default function InventoryMovementsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, tenantId } = useAuth();

  const locationId = searchParams.get("locationId") || "";
  const actionFilter = searchParams.get("action") || "all";
  const refIdFilter = searchParams.get("refId") || "";
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!locationId) {
      setError("Missing locationId query parameter");
      setLoading(false);
      return;
    }

    const fetchMovements = async () => {
      setLoading(true);
      setError(null);
      try {
        const query: Record<string, string | number> = {
          locationId,
          limit,
          sort: "desc",
        };
        if (actionFilter !== "all") query.action = actionFilter;
        if (refIdFilter) query.refId = refIdFilter;

        const res = await apiFetch<MovementsResponse>("/inventory/movements", {
          token: token || undefined,
          tenantId,
          query,
        });
        setMovements(res.items || []);
        setNext(res.next || null);
      } catch (err: any) {
        setError(err?.message || "Failed to load movements");
      } finally {
        setLoading(false);
      }
    };

    fetchMovements();
  }, [locationId, actionFilter, refIdFilter, limit, token, tenantId]);

  const handleLoadMore = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const query: Record<string, string | number> = {
        locationId,
        limit,
        sort: "desc",
        next,
      };
      if (actionFilter !== "all") query.action = actionFilter;
      if (refIdFilter) query.refId = refIdFilter;

      const res = await apiFetch<MovementsResponse>("/inventory/movements", {
        token: token || undefined,
        tenantId,
        query,
      });
      setMovements((prev) => [...prev, ...(res.items || [])]);
      setNext(res.next || null);
    } catch (err: any) {
      console.error("Failed to load more movements", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Reset pagination when filters change
    params.delete("next");
    setSearchParams(params);
  };

  if (loading) {
    return <div style={{ padding: 16 }}>Loading movements...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4, marginBottom: 16 }}>
          {error}
        </div>
        <Link to="/inventory">Back to Inventory</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1>Inventory Movements by Location</h1>
        <Link to="/inventory">Back to Inventory</Link>
      </div>

      <div style={{ marginBottom: 16, padding: 12, background: "#f5f5f5", borderRadius: 4 }}>
        <strong>Location ID:</strong> {locationId}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Action:
          <select
            value={actionFilter}
            onChange={(e) => updateFilter("action", e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
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

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Ref ID:
          <input
            type="text"
            value={refIdFilter}
            onChange={(e) => updateFilter("refId", e.target.value)}
            placeholder="Filter by reference ID"
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, width: 200 }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Page Size:
          <select
            value={limit}
            onChange={(e) => updateFilter("limit", e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
      </div>

      <MovementsTable movements={movements} showItemId emptyText="No movements found for this location." />

      {next && (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              padding: "10px 20px",
              background: "#08a",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: loadingMore ? "not-allowed" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {movements.length > 0 && (
        <div style={{ marginTop: 16, color: "#666", fontSize: 14 }}>
          Showing {movements.length} movement{movements.length !== 1 ? "s" : ""}
          {next && " (more available)"}
        </div>
      )}
    </div>
  );
}
