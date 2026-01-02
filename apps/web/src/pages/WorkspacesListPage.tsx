import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

type Workspace = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
  updatedAt?: string;
  createdAt?: string;
};

type WorkspacePage = { items?: Workspace[]; next?: string };

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

export default function WorkspacesListPage() {
  const { token, tenantId } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [items, setItems] = useState<Workspace[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEntityType, setCreateEntityType] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createShared, setCreateShared] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<WorkspacePage>("/workspaces", {
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

  const handleCreate = async () => {
    if (!createName.trim()) {
      setCreateError("Name is required");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const payload: any = {
        name: createName.trim(),
        shared: createShared,
      };
      if (createEntityType) payload.entityType = createEntityType;
      if (createDescription.trim()) payload.description = createDescription.trim();

      const result = await apiFetch<Workspace>("/workspaces", {
        method: "POST",
        token: token || undefined,
        tenantId,
        body: payload,
      });

      // Close modal and reset
      setShowCreateModal(false);
      setCreateName("");
      setCreateEntityType("");
      setCreateDescription("");
      setCreateShared(false);

      // Refresh list
      setItems([]);
      setNext(null);
      await fetchPage();

      // Navigate to new workspace detail
      if (result?.id) {
        window.location.href = `/workspaces/${result.id}`;
      }
    } catch (err) {
      setCreateError(formatError(err));
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Workspaces</h1>
        <button onClick={() => setShowCreateModal(true)} style={{ padding: "8px 16px" }}>
          + Create Workspace
        </button>
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
          No workspaces found.
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
                  <Link to={`/workspaces/${item.id}`}>{item.name || "(no name)"}</Link>
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
                  <Link to={`/workspaces/${item.id}`}>View</Link>
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

      {showCreateModal && (
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
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 24,
              borderRadius: 8,
              maxWidth: 500,
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Create Workspace</h2>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                  Name *
                </label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="My Workspace"
                  style={{ width: "100%", padding: 8 }}
                  maxLength={200}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                  Entity Type
                </label>
                <select
                  value={createEntityType}
                  onChange={(e) => setCreateEntityType(e.target.value)}
                  style={{ width: "100%", padding: 8 }}
                >
                  <option value="">-- None --</option>
                  {ENTITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                  Description
                </label>
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Optional description"
                  style={{ width: "100%", padding: 8, minHeight: 80 }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  id="create-shared"
                  checked={createShared}
                  onChange={(e) => setCreateShared(e.target.checked)}
                />
                <label htmlFor="create-shared">Shared</label>
              </div>

              {createError && (
                <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleCreate}
                  disabled={createLoading}
                  style={{ flex: 1, padding: "10px 16px" }}
                >
                  {createLoading ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateName("");
                    setCreateEntityType("");
                    setCreateDescription("");
                    setCreateShared(false);
                    setCreateError(null);
                  }}
                  disabled={createLoading}
                  style={{ padding: "10px 16px" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
