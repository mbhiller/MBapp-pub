import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type Party = {
  id: string;
  name?: string;
  kind?: string;
  roles?: string[];
};

type PartyPage = { items?: Party[]; next?: string };

function formatError(err: unknown): string {
  const e = err as any;
  const parts = [] as string[];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function PartiesListPage() {
  const { token, tenantId } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<Party[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<PartyPage>("/objects/party", {
          token: token || undefined,
          tenantId,
          query: {
            limit: 20,
            next: cursor ?? undefined,
            q: filter || undefined,
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
    [filter, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const onSearch = () => {
    setFilter(search.trim());
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Parties</h1>
        <Link to="/parties/new">Create Party</Link>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or role"
          style={{ flex: 1 }}
        />
        <button onClick={onSearch} disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {error ? <div style={{ color: "#b00020" }}>{error}</div> : null}

      {loading && items.length === 0 ? <div>Loading...</div> : null}

      {!loading && items.length === 0 ? <div>No parties found.</div> : null}

      {items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "8px" }}>Name</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "8px" }}>Kind</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "8px" }}>Roles</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>
                  <Link to={`/parties/${p.id}`}>{p.name || p.id}</Link>
                </td>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{p.kind || "—"}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{p.roles?.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {next ? (
        <button onClick={() => fetchPage(next)} disabled={loading}>
          {loading ? "Loading..." : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
