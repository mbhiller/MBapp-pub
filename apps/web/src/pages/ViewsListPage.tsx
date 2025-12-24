import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type View = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
  updatedAt?: string;
  createdAt?: string;
};

type ViewPage = { items?: View[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

const ENTITY_TYPES = [
  "purchaseOrder",
  "salesOrder",
  "inventoryItem",
  "party",
  "account",
  "event",
  "employee",
  "organization",
  "product",
  "class",
  "division",
];

export default function ViewsListPage() {
  const { token, tenantId } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [items, setItems] = useState<View[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<ViewPage>("/views", {
          token: token || undefined,
          tenantId,
          query: {
            limit: 20,
            next: cursor ?? undefined,
            q: filter || undefined,
            entityType: entityTypeFilter || undefined,
          },
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [filter, entityTypeFilter, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const onSearch = () => {
    setFilter(search.trim());
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete view "${name}"?`)) return;

    try {
      await apiFetch(`/views/${encodeURIComponent(id)}`, {
        method: "DELETE",
        token: token || undefined,
        tenantId,
      });
      // Refresh list
      setItems([]);
      setNext(null);
      fetchPage();
    } catch (err) {
      alert("Delete failed: " + formatError(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Views</h1>
        <Link to="/views/new">Create View</Link>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            style={{ flex: 1 }}
          />
          <select
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
            style={{ minWidth: 150 }}
          >
            <option value="">All entity types</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button onClick={onSearch} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
          {error}
        </div>
      )}

      {loading && items.length === 0 && <div>Loading...</div>}

      {items.length === 0 && !loading && (
        <div style={{ padding: 32, textAlign: "center", color: "#666" }}>
          No views found. <Link to="/views/new">Create one?</Link>
        </div>
      )}

      {items.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: "#eee", textAlign: "left" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Name</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Entity Type</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Updated</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <Link to={`/views/${item.id}`}>{item.name || "(no name)"}</Link>
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {item.entityType || "—"}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {item.updatedAt
                    ? new Date(item.updatedAt).toLocaleDateString()
                    : item.createdAt
                    ? new Date(item.createdAt).toLocaleDateString()
                    : "—"}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Link to={`/views/${item.id}`}>View</Link>
                    <Link to={`/views/${item.id}/edit`}>Edit</Link>
                    <button
                      onClick={() => handleDelete(item.id, item.name || item.id)}
                      style={{
                        padding: "2px 8px",
                        fontSize: 12,
                        cursor: "pointer",
                        background: "#fee",
                        border: "1px solid #c00",
                        color: "#c00",
                        borderRadius: 2,
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {next && (
        <div>
          <button onClick={() => fetchPage(next)} disabled={loading}>
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
