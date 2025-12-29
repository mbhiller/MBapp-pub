import { useState } from "react";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import type { ViewConfig } from "../hooks/useViewFilters";

type ViewFilter = { field: string; op: string; value: any };

type SortConfig = { field: string; dir?: "asc" | "desc" };

type Props = {
  entityType: string;
  filters: ViewFilter[];
  sort?: SortConfig;
  buttonLabel?: string;
  onSaved?: (view: ViewConfig) => void;
};

function normalizeFilters(filters: ViewFilter[]): ViewFilter[] {
  return filters
    .filter(Boolean)
    .filter((f) => f.field && f.op)
    .filter((f) => !(typeof f.value === "string" ? f.value.trim() === "" : f.value === undefined || f.value === null));
}

export function SaveViewButton({ entityType, filters, sort, buttonLabel, onSaved }: Props) {
  const { token, tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("View name is required");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const payload: Partial<ViewConfig> & { entityType: string } = {
        name: name.trim(),
        entityType,
        filters: normalizeFilters(filters),
        sort: sort && sort.field ? sort : undefined,
        description: description.trim() || undefined,
        shared: shared || undefined,
      };

      const created = await apiFetch<ViewConfig>('/views', {
        method: 'POST',
        body: payload,
        token: token || undefined,
        tenantId,
      });

      if (created?.id) {
        setMessage(`Saved view "${created.name || created.id}"`);
        setOpen(false);
        setName("");
        setDescription("");
        setShared(false);
        onSaved?.(created);
      } else {
        setError('Failed to save view');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save view');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {message && (
        <div style={{ color: "#0a6522", fontSize: 12 }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ color: "#b00020", fontSize: 12 }}>
          {error}
        </div>
      )}

      <button onClick={() => setOpen(true)} disabled={loading} style={{ padding: "6px 10px" }}>
        {loading ? "Saving..." : buttonLabel || "Save as View"}
      </button>

      {open && (
        <div
          style={{
            padding: 12,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 4,
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>Save current filters as a View</div>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12 }}>Name (required)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="View name"
              style={{ padding: 6, border: "1px solid #ccc", borderRadius: 3 }}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12 }}>Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this view capture?"
              rows={2}
              style={{ padding: 6, border: "1px solid #ccc", borderRadius: 3 }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            Shared (visible to workspace members)
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              style={{ background: "#007bff", color: "#fff", padding: "6px 12px", border: "none", borderRadius: 3 }}
            >
              {loading ? "Saving..." : "Save View"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
