import React, { useState } from "react";
import { ViewConfig, useViewFilters, FilterMapResult } from "../hooks/useViewFilters";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_VIEW_WRITE } from "../generated/permissions";
import { permissionRequiredTooltip } from "../lib/permissionMessages";

type Props = {
  entityType: string;
  /** Maps View filters to the list page's filter state shape */
  mapViewToFilterState: (view: ViewConfig) => FilterMapResult;
  /** Callback when a view is applied. Receives the mapped filter state. */
  onApplyView: (filterState: Record<string, any>) => void;
  /** Current filter state for "save as new" and "overwrite" operations */
  currentFilterState: Record<string, any>;
};

/**
 * Reusable component for selecting, applying, saving, and overwriting Views.
 * Place this above or beside your list filter controls.
 *
 * Features:
 * - Load and display available Views for the entityType
 * - Select and apply a View (updates caller's filter state)
 * - Save current filters as a new View
 * - Overwrite an existing View
 */
export function ViewSelector({
  entityType,
  mapViewToFilterState,
  onApplyView,
  currentFilterState,
}: Props) {
  const { policy, policyLoading } = useAuth();
  const canWriteViews = hasPerm(policy, PERM_VIEW_WRITE) && !policyLoading;
  
  const {
    views,
    selectedView,
    setSelectedView,
    loading,
    error,
    setError,
    loadViews,
    applyView,
    saveAsNewView,
    overwriteView,
  } = useViewFilters(entityType, mapViewToFilterState);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);

  const [showOverwriteModal, setShowOverwriteModal] = useState(false);
  const [overwriteLoading, setOverwriteLoading] = useState(false);

  // Load views on mount
  React.useEffect(() => {
    loadViews();
  }, [loadViews]);

  const handleSelectView = (viewId: string) => {
    const view = views.find((v) => v.id === viewId) || null;
    setSelectedView(view);
    if (view) {
      const result = applyView(view, onApplyView);
      if (result.unsupported.length > 0) {
        // Error is already set in the hook, no additional toast needed here
      }
    }
  };

  const handleSaveNew = async () => {
    if (!saveName.trim()) {
      setError("View name is required");
      return;
    }

    setSaveLoading(true);
    const created = await saveAsNewView(saveName, currentFilterState);
    setSaveLoading(false);

    if (created) {
      setShowSaveModal(false);
      setSaveName("");
      setSelectedView(created);
    }
  };

  const handleOverwrite = async () => {
    if (!selectedView?.id) {
      setError("No view selected to overwrite");
      return;
    }

    if (!window.confirm(`Overwrite "${selectedView.name || selectedView.id}"?`)) {
      return;
    }

    setOverwriteLoading(true);
    const ok = await overwriteView(selectedView.id, selectedView.name || "", currentFilterState);
    setOverwriteLoading(false);

    if (ok) {
      setShowOverwriteModal(false);
      // Selected view is already updated in state
    }
  };

  return (
    <div style={{ display: "grid", gap: 12, padding: "12px", background: "#f9f9f9", borderRadius: 4 }}>
      {/* Error banner */}
      {error && (
        <div style={{ padding: 8, background: "#fee", color: "#c00", borderRadius: 4, fontSize: 12 }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: 8, padding: "2px 6px", fontSize: 11 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* View selector row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 200 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>Saved View:</span>
          <select
            value={selectedView?.id || ""}
            onChange={(e) => handleSelectView(e.target.value)}
            disabled={loading}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="">{loading ? "Loading..." : "-- None --"}</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name || view.id}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => setShowSaveModal(true)}
          disabled={loading || !canWriteViews}
          title={!canWriteViews ? permissionRequiredTooltip(PERM_VIEW_WRITE) : ""}
          style={{ padding: "6px 10px", opacity: !canWriteViews ? 0.5 : 1 }}
        >
          Save As View
        </button>

        {selectedView && (
          <button
            onClick={() => setShowOverwriteModal(true)}
            disabled={loading || !canWriteViews}
            title={!canWriteViews ? permissionRequiredTooltip(PERM_VIEW_WRITE) : ""}
            style={{ padding: "6px 10px", opacity: !canWriteViews ? 0.5 : 1 }}
          >
            Overwrite
          </button>
        )}
      </div>

      {/* Save as new view modal */}
      {showSaveModal && (
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
          <div style={{ fontSize: 12, fontWeight: 500 }}>Save as New View</div>
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="View name (required)"
            style={{ padding: 6, borderRadius: 3, border: "1px solid #ccc" }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => setShowSaveModal(false)} disabled={saveLoading}>
              Cancel
            </button>
            <button
              onClick={handleSaveNew}
              disabled={saveLoading || !saveName.trim()}
              style={{ background: "#007bff", color: "#fff", padding: "6px 10px", border: "none", borderRadius: 3 }}
            >
              {saveLoading ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Overwrite modal */}
      {showOverwriteModal && (
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
          <div style={{ fontSize: 12 }}>
            Overwrite "{selectedView?.name || selectedView?.id}" with current filters?
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => setShowOverwriteModal(false)} disabled={overwriteLoading}>
              Cancel
            </button>
            <button
              onClick={handleOverwrite}
              disabled={overwriteLoading}
              style={{
                background: "#d32f2f",
                color: "#fff",
                padding: "6px 10px",
                border: "none",
                borderRadius: 3,
              }}
            >
              {overwriteLoading ? "Updating..." : "Overwrite"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
