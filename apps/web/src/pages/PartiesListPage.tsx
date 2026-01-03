import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { SaveViewButton } from "../components/SaveViewButton";
import { ViewSelector } from "../components/ViewSelector";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { mapViewToPartyFilters } from "../lib/viewFilterMappers";
import type { ViewConfig } from "../hooks/useViewFilters";

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
  const { token, tenantId, policy, policyLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<Party[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedView, setAppliedView] = useState<ViewConfig | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const canCreateParty = hasPerm(policy, "party:write") && !policyLoading;

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

  // Handle View application: apply mapped filters and refresh the list
  const handleApplyView = useCallback(
    (mappedState: Record<string, any>) => {
      if (mappedState.q !== undefined) {
        const newQ = mappedState.q ?? "";
        setSearch(newQ);
        setFilter(newQ);
      }
    },
    []
  );

  const currentFilterState = {
    q: filter,
  };

  // Initialize from URL params: viewId
  useEffect(() => {
    const urlViewId = searchParams.get("viewId") || "";

    if (urlViewId) {
      setActiveViewId(urlViewId);
      (async () => {
        try {
          const view = await apiFetch<ViewConfig>(`/views/${urlViewId}`, {
            token: token || undefined,
            tenantId,
          });
          if (view) {
            setAppliedView(view);
            const mapped = mapViewToPartyFilters(view);
            if (mapped.applied.q !== undefined) {
              const newQ = mapped.applied.q ?? "";
              setSearch(newQ);
              setFilter(newQ);
            }
          }
        } catch {
          // Ignore silently if view cannot be fetched
        }
      })();
    } else {
      setActiveViewId(null);
    }
  }, [searchParams, tenantId, token]);

  const currentViewFilters = [
    filter.trim() ? { field: "q", op: "contains", value: filter.trim() } : null,
  ].filter(Boolean) as Array<{ field: string; op: string; value: any }>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Parties</h1>
        {canCreateParty && <Link to="/parties/new">Create Party</Link>}
      </div>

      <ViewSelector
        entityType="party"
        mapViewToFilterState={mapViewToPartyFilters}
        onApplyView={handleApplyView}
        currentFilterState={currentFilterState}
      />

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
        <SaveViewButton
          entityType="party"
          filters={currentViewFilters}
          buttonLabel="Save as View"
          activeViewId={activeViewId || undefined}
          activeViewName={appliedView?.name}
        />
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
