import { type FormEvent, useEffect, useState } from "react";

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
] as const;

type ViewInput = {
  name: string;
  entityType: string;
  description?: string;
  filters?: Array<{ field: string; op: string; value: any }>;
  columns?: string[];
};

type Props = {
  initialValue?: Partial<ViewInput>;
  submitLabel?: string;
  onSubmit: (value: ViewInput) => Promise<void> | void;
};

export function ViewForm({ initialValue, submitLabel = "Save", onSubmit }: Props) {
  const [name, setName] = useState(initialValue?.name ?? "");
  const [entityType, setEntityType] = useState(initialValue?.entityType ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const [filtersJson, setFiltersJson] = useState(
    initialValue?.filters ? JSON.stringify(initialValue.filters, null, 2) : ""
  );
  const [columnsCsv, setColumnsCsv] = useState(
    initialValue?.columns ? initialValue.columns.join(", ") : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersError, setFiltersError] = useState<string | null>(null);

  useEffect(() => {
    setName(initialValue?.name ?? "");
    setEntityType(initialValue?.entityType ?? "");
    setDescription(initialValue?.description ?? "");
    setFiltersJson(
      initialValue?.filters ? JSON.stringify(initialValue.filters, null, 2) : ""
    );
    setColumnsCsv(initialValue?.columns ? initialValue.columns.join(", ") : "");
  }, [
    initialValue?.name,
    initialValue?.entityType,
    initialValue?.description,
    initialValue?.filters,
    initialValue?.columns,
  ]);

  // Validate filtersJson on change
  useEffect(() => {
    if (!filtersJson.trim()) {
      setFiltersError(null);
      return;
    }
    try {
      const parsed = JSON.parse(filtersJson);
      if (!Array.isArray(parsed)) {
        setFiltersError("Filters must be a JSON array");
      } else {
        setFiltersError(null);
      }
    } catch {
      setFiltersError("Invalid JSON format");
    }
  }, [filtersJson]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Name is required");
      }
      if (trimmedName.length < 1 || trimmedName.length > 120) {
        throw new Error("Name must be between 1 and 120 characters");
      }
      if (!entityType) {
        throw new Error("Entity type is required");
      }

      // Parse filters
      let filters: any[] | undefined;
      if (filtersJson.trim()) {
        try {
          const parsed = JSON.parse(filtersJson);
          if (!Array.isArray(parsed)) {
            throw new Error("Filters must be a JSON array");
          }
          filters = parsed;
        } catch (err) {
          throw new Error("Invalid filters JSON: " + (err as Error).message);
        }
      }

      // Parse columns
      const columns = columnsCsv
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

      const payload: ViewInput = {
        name: trimmedName,
        entityType,
        description: description.trim() || undefined,
        filters: filters && filters.length > 0 ? filters : undefined,
        columns: columns.length > 0 ? columns : undefined,
      };

      await onSubmit(payload);
    } catch (err) {
      const message = (err as any)?.message ?? "Request failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 480 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span>Name *</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Entity Type *</span>
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} required>
          <option value="">-- Select entity type --</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Optional description"
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Filters (JSON array)</span>
        <textarea
          value={filtersJson}
          onChange={(e) => setFiltersJson(e.target.value)}
          rows={6}
          placeholder='[{"field": "status", "op": "eq", "value": "active"}]'
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            borderColor: filtersError ? "#c00" : undefined,
          }}
        />
        {filtersError && (
          <span style={{ fontSize: 12, color: "#c00" }}>{filtersError}</span>
        )}
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Columns (comma-separated)</span>
        <input
          type="text"
          value={columnsCsv}
          onChange={(e) => setColumnsCsv(e.target.value)}
          placeholder="id, name, status"
        />
        <span style={{ fontSize: 12, color: "#666" }}>
          Reserved for Sprint IV+. Optional field names to display.
        </span>
      </label>

      {error && (
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={submitting || !!filtersError}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
