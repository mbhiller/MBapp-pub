import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../providers/AuthProvider";
import { listLocations, type Location } from "../lib/locations";

type Props = {
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
};

export default function LocationPicker({ value, onChange, disabled }: Props) {
  const { token, tenantId } = useAuth();
  const [items, setItems] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await listLocations({ limit: 50 }, { token: token || undefined, tenantId });
        if (!cancelled) setItems(res.items ?? []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load locations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, token]);

  const selectValue = useMemo(() => {
    // Only reflect value in <select> if it matches a known location id
    const match = items.find((l) => String(l.id ?? "") === String(value ?? ""));
    return match ? String(match.id) : "";
  }, [items, value]);

  const renderLabel = (loc: Location) => {
    return (
      loc.name || loc.label || (loc as any).displayName || String(loc.id ?? "Unknown")
    );
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Location:
          <select
            value={selectValue}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || loading}
            style={{ minWidth: 200 }}
          >
            <option value="">Select a location…</option>
            {items.map((loc) => {
              const idStr = String(loc.id ?? "");
              return (
                <option key={idStr || Math.random().toString(36)} value={idStr}>
                  {idStr} — {renderLabel(loc)}
                </option>
              );
            })}
          </select>
        </label>
      )}

      {/* Manual entry fallback: always present so user can bypass list */}
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Enter Location ID:
        <input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={items.length === 0 ? (loading ? "Loading…" : error ? "Failed to load; enter manually" : "Enter location ID") : "Or enter manually"}
          style={{ minWidth: 200 }}
        />
      </label>
    </div>
  );
}
