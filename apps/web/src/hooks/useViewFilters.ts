import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";

/**
 * Represents a saved View with filters and sort configuration.
 */
export type ViewConfig = {
  id: string;
  name?: string;
  entityType?: string;
  description?: string;
  shared?: boolean;
  filters?: Array<{ field: string; op: string; value: any }>;
  sort?: { field: string; dir?: "asc" | "desc" };
};

/**
 * Maps View filters to list page filter state.
 * Caller defines the mapping based on their specific list page shape.
 */
export type FilterMapResult = {
  applied: Record<string, any>;
  unsupported: Array<{ field: string; reason: string }>;
};

/**
 * Hook for loading, applying, saving, and overwriting saved Views on list pages.
 *
 * Usage:
 * ```
 * const {
 *   views, loadViews, selectedView, setSelectedView,
 *   applyView, saveAsNewView, overwriteView
 * } = useViewFilters("purchaseOrder", mapViewToState);
 *
 * // Load views for entityType
 * loadViews();
 *
 * // Apply selected view to list state
 * applyView(selectedView, refreshList);
 *
 * // Save current state as a new view
 * saveAsNewView("My View", listState);
 * ```
 */
export function useViewFilters(
  entityType: string,
  mapViewToFilterState: (view: ViewConfig) => FilterMapResult
) {
  const { token, tenantId } = useAuth();
  const [views, setViews] = useState<ViewConfig[]>([]);
  const [selectedView, setSelectedView] = useState<ViewConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch all views for the given entityType.
   */
  const loadViews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items?: ViewConfig[] }>(
        `/views?entityType=${encodeURIComponent(entityType)}&limit=100`,
        { token: token || undefined, tenantId }
      );
      setViews(res?.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load views");
    } finally {
      setLoading(false);
    }
  }, [entityType, token, tenantId]);

  /**
   * Apply the selected view's filters and sort to the list state.
   * Returns the mapped state and any unsupported filters.
   * Caller is responsible for updating their own state and triggering a refresh.
   */
  const applyView = useCallback(
    (view: ViewConfig | null, onApply: (mappedState: Record<string, any>) => void) => {
      if (!view) return { applied: {}, unsupported: [] };

      const result = mapViewToFilterState(view);

      // If there are unsupported filters, the caller can show a toast
      if (result.unsupported.length > 0) {
        setError(
          `${result.unsupported.length} filter(s) not supported: ${result.unsupported
            .map((u) => `${u.field} (${u.reason})`)
            .join(", ")}`
        );
      } else {
        setError(null);
      }

      // Apply the state
      onApply(result.applied);

      return result;
    },
    [mapViewToFilterState]
  );

  /**
   * Save the current list state as a new View.
   */
  const saveAsNewView = useCallback(
    async (name: string, currentState: Record<string, any>): Promise<ViewConfig | null> => {
      try {
        setLoading(true);
        setError(null);

        // Convert list state back to View filter format
        // This is a generic helper; caller may need custom mapping
        const filters = Object.entries(currentState)
          .map(([field, value]) => {
            if (!value || (typeof value === "string" && value.trim() === "")) return null;
            return { field, op: "eq", value };
          })
          .filter((f): f is { field: string; op: string; value: any } => Boolean(f));

        const payload: Partial<ViewConfig> = {
          name,
          entityType,
          filters,
          description: `Saved on ${new Date().toISOString()}`,
        };

        const created = await apiFetch<ViewConfig>("/views", {
          method: "POST",
          body: payload,
          token: token || undefined,
          tenantId,
        });

        if (created?.id) {
          setViews((prev) => [...prev, created]);
          setSelectedView(created);
          setError(null);
          return created;
        }

        setError("Failed to create view");
        return null;
      } catch (err: any) {
        setError(err?.message ?? "Failed to save view");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [entityType, token, tenantId]
  );

  /**
   * Overwrite an existing View with the current list state.
   */
  const overwriteView = useCallback(
    async (viewId: string, name: string, currentState: Record<string, any>): Promise<boolean> => {
      try {
        setLoading(true);
        setError(null);

        const filters = Object.entries(currentState)
          .map(([field, value]) => {
            if (!value || (typeof value === "string" && value.trim() === "")) return null;
            return { field, op: "eq", value };
          })
          .filter((f): f is { field: string; op: string; value: any } => Boolean(f));

        const payload: Partial<ViewConfig> = {
          name,
          entityType,
          filters,
          description: `Updated on ${new Date().toISOString()}`,
        };

        await apiFetch(`/views/${encodeURIComponent(viewId)}`, {
          method: "PUT",
          body: payload,
          token: token || undefined,
          tenantId,
        });

        // Update local state
        setViews((prev) =>
          prev.map((v) => (v.id === viewId ? { ...v, ...payload } : v))
        );
        setError(null);
        return true;
      } catch (err: any) {
        setError(err?.message ?? "Failed to overwrite view");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [entityType, token, tenantId]
  );

  return {
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
  };
}
