import { useState } from "react";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_VIEW_WRITE } from "../generated/permissions";
import { permissionDeniedMessage, permissionRequiredTooltip } from "../lib/permissionMessages";
import type { ViewConfig } from "../hooks/useViewFilters";

type ViewFilter = { field: string; op: string; value: any };

type SortConfig = { field: string; dir?: "asc" | "desc" };

type Props = {
  entityType: string;
  filters: ViewFilter[];
  sort?: SortConfig;
  buttonLabel?: string;
  activeViewId?: string; // If set, enable "Update View" mode
  activeViewName?: string; // Current name of the active view (for display)
  onSaved?: (view: ViewConfig) => void;
};

function normalizeFilters(filters: ViewFilter[]): ViewFilter[] {
  return filters
    .filter(Boolean)
    .filter((f) => f.field && f.op)
    .filter((f) => !(typeof f.value === "string" ? f.value.trim() === "" : f.value === undefined || f.value === null));
}

export function SaveViewButton({ entityType, filters, sort, buttonLabel, activeViewId, activeViewName, onSaved }: Props) {
  const { token, tenantId, policy, policyLoading } = useAuth();
  const canWriteViews = hasPerm(policy, PERM_VIEW_WRITE) && !policyLoading;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"update" | "save">(activeViewId ? "update" : "save");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (mode === "save" && !name.trim()) {
      setError("View name is required");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const payload: Partial<ViewConfig> & { entityType: string } = {
        name: name.trim() || undefined, // For update mode, undefined name means no change
        entityType,
        filters: normalizeFilters(filters),
        sort: sort && sort.field ? sort : undefined,
        description: description.trim() || undefined,
        shared: shared || undefined,
      };

      // If in update mode, use PATCH with PUT fallback on 405; otherwise POST
      const isUpdate = mode === "update" && activeViewId;
      const endpoint = isUpdate ? `/views/${activeViewId}` : "/views";

      const doSave = async () => {
        if (!isUpdate) {
          return apiFetch<ViewConfig>(endpoint, { method: "POST", body: payload, token: token || undefined, tenantId });
        }
        try {
          return await apiFetch<ViewConfig>(endpoint, { method: "PATCH", body: payload, token: token || undefined, tenantId });
        } catch (err: any) {
          if (err?.status === 405) {
            return apiFetch<ViewConfig>(endpoint, { method: "PUT", body: payload, token: token || undefined, tenantId });
          }
          throw err;
        }
      };

      const result = await doSave();

      if (result?.id) {
        const action = isUpdate ? "Updated" : "Saved";
        setMessage(`${action} view "${result.name || result.id}"`);
        setOpen(false);
        setName("");
        setDescription("");
        setShared(false);
        onSaved?.(result);
      } else {
        setError(`Failed to ${isUpdate ? "update" : "save"} view`);
      }
    } catch (err: any) {
      if (err?.status === 403) {
        setError(permissionDeniedMessage(PERM_VIEW_WRITE));
      } else {
        setError(err?.message || `Failed to ${mode === "update" ? "update" : "save"} view`);
      }
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

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => { setMode(activeViewId ? "update" : "save"); setOpen(true); }}
          disabled={loading || !canWriteViews}
          title={!canWriteViews ? permissionRequiredTooltip(PERM_VIEW_WRITE) : ""}
          style={{ padding: "6px 10px", opacity: !canWriteViews ? 0.5 : 1 }}
        >
          {loading ? (activeViewId ? "Updating..." : "Saving...") : (buttonLabel || (activeViewId ? "Update View" : "Save as View"))}
        </button>
        {activeViewId && (
          <button
            onClick={() => { setMode("save"); setOpen(true); }}
            disabled={loading || !canWriteViews}
            title={!canWriteViews ? permissionRequiredTooltip(PERM_VIEW_WRITE) : ""}
            style={{ padding: "6px 10px", background: "#f5f5f5", border: "1px solid #ccc", opacity: !canWriteViews ? 0.5 : 1 }}
          >
            Save as New
          </button>
        )}
      </div>

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
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {mode === "update" ? `Update "${activeViewName || activeViewId}"` : "Save current filters as a View"}
          </div>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12 }}>Name {mode === "update" ? "(leave empty to keep unchanged)" : "(required)"}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "update" ? activeViewName || "View name" : "View name"}
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
              disabled={loading || (mode === "save" && !name.trim())}
              style={{ background: "#007bff", color: "#fff", padding: "6px 12px", border: "none", borderRadius: 3 }}
            >
              {loading ? (mode === "update" ? "Updating..." : "Saving...") : (mode === "update" ? "Update View" : "Save View")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
