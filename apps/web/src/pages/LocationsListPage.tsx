import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";

// Shape aligns with Location spec additions
type Location = {
  id: string;
  name?: string;
  code?: string | null;
  status?: string | null;
  updatedAt?: string | null;
};

type LocationPage = { items?: Location[]; next?: string | null };

type CreateForm = { name: string; code: string; status: "active" | "inactive" };

type EditForm = { id: string; name: string; code: string; status: "active" | "inactive" };

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function LocationsListPage() {
  const { token, tenantId, policy, policyLoading } = useAuth();

  // Fail-closed permission check: allow write if user has location:write OR objects:write
  const canEditLocations = (hasPerm(policy, "location:write") || hasPerm(policy, "objects:write")) && !policyLoading;
  const [items, setItems] = useState<Location[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [create, setCreate] = useState<CreateForm>({ name: "", code: "", status: "active" });
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const queryParams = useMemo(() => {
    const q: Record<string, string | number | boolean | undefined> = {
      limit: 50,
      sort: "desc",
    };
    if (statusFilter && statusFilter !== "all") {
      q["filter.status"] = statusFilter;
    }
    return q;
  }, [statusFilter]);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<LocationPage>("/objects/location", {
          token: token || undefined,
          tenantId,
          query: { ...queryParams, next: cursor ?? undefined },
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [queryParams, tenantId, token]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  async function createLocation() {
    if (!create.name.trim()) {
      setError("Name is required");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await apiFetch<Location>("/objects/location", {
        method: "POST",
        tenantId,
        token: token || undefined,
        body: {
          name: create.name.trim(),
          code: create.code.trim() || undefined,
          status: create.status,
        },
      });
      setCreate({ name: "", code: "", status: "active" });
      // refresh from first page
      await fetchPage();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(loc: Location) {
    setEditing({
      id: loc.id,
      name: String(loc.name ?? ""),
      code: String(loc.code ?? ""),
      status: (String(loc.status ?? "active") as "active" | "inactive"),
    });
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch<Location>(`/objects/location/${encodeURIComponent(editing.id)}` , {
        method: "PUT",
        tenantId,
        token: token || undefined,
        body: {
          name: editing.name.trim(),
          code: editing.code.trim() || undefined,
          status: editing.status,
        },
      });
      setEditing(null);
      // reload first page to reflect changes
      await fetchPage();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Locations</h1>
      </div>

      {/* Create form */}
      {canEditLocations && (
        <div style={{ padding: 12, background: "#eef4ff", border: "1px solid #cbd5e1", borderRadius: 4 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={create.name}
              onChange={(e) => setCreate((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Name (required)"
              style={{ flex: 2 }}
            />
            <input
              value={create.code}
              onChange={(e) => setCreate((prev) => ({ ...prev, code: e.target.value }))}
              placeholder="Code (optional)"
              style={{ flex: 1 }}
            />
            <select
              value={create.status}
              onChange={(e) => setCreate((prev) => ({ ...prev, status: e.target.value as any }))}
              style={{ minWidth: 140 }}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
            <button onClick={createLocation} disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label>Status:</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ minWidth: 160 }}>
          <option value="all">All</option>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
        <button onClick={() => fetchPage()} disabled={loading}>
          {loading ? "Loading..." : "Apply"}
        </button>
      </div>

      {error ? (
        <div style={{ padding: 12, background: "#fee", color: "#b00020", borderRadius: 4 }}>{error}</div>
      ) : null}
      {loading && items.length === 0 ? <div>Loading...</div> : null}
      {!loading && items.length === 0 ? <div>No locations found.</div> : null}

      {items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#eee" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Name</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Code</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Status</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Updated</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((loc) => (
              <tr key={loc.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {editing?.id === loc.id ? (
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                      style={{ width: "100%" }}
                    />
                  ) : (
                    <Link to={`/locations/${encodeURIComponent(loc.id)}`} style={{ color: "#08a", textDecoration: "none" }}>
                      {loc.name || "(no name)"}
                    </Link>
                  )}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {editing?.id === loc.id ? (
                    <input
                      value={editing.code}
                      onChange={(e) => setEditing((prev) => (prev ? { ...prev, code: e.target.value } : prev))}
                      style={{ width: "100%" }}
                    />
                  ) : (
                    (loc.code as any) || ""
                  )}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {editing?.id === loc.id ? (
                    <select
                      value={editing.status}
                      onChange={(e) => setEditing((prev) => (prev ? { ...prev, status: e.target.value as any } : prev))}
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  ) : (
                    String(loc.status ?? "")
                  )}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{loc.updatedAt || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  {canEditLocations && (
                    editing?.id === loc.id ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
                        <button onClick={cancelEdit} disabled={saving}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(loc)}>Edit</button>
                    )
                  )}
                </td>
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
