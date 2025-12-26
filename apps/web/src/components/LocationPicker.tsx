import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../providers/AuthProvider";
import { listLocations, type Location } from "../lib/locations";

type Props = {
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  tenantId?: string; // optional override; defaults to AuthProvider
  token?: string;    // optional override; defaults to AuthProvider
};

export default function LocationPicker({ value, onChange, disabled, tenantId: tOverride, token: tokOverride }: Props) {
  const auth = useAuth();
  const token = tokOverride ?? auth.token ?? undefined;
  const tenantId = tOverride ?? auth.tenantId;
  const [items, setItems] = useState<Location[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listLocations({ limit: 200 }, { token, tenantId });
      setItems(res.items ?? []);
      setNext(res.next ?? null);
    } catch (err: any) {
      setError(err?.message || "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [tenantId, token]);

  const loadMore = useCallback(async () => {
    if (!next) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listLocations({ limit: 200, next }, { token, tenantId });
      setItems((prev) => [...prev, ...(res.items ?? [])]);
      setNext(res.next ?? null);
    } catch (err: any) {
      setError(err?.message || "Failed to load more");
    } finally {
      setLoading(false);
    }
  }, [next, tenantId, token]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const selectValue = useMemo(() => {
    // Only reflect value in <select> if it matches a known location id
    const match = items.find((l) => String(l.id ?? "") === String(value ?? ""));
    return match ? String(match.id) : "";
  }, [items, value]);

  const renderLabel = (loc: Location) => {
    const code = String((loc as any)?.code ?? "").trim();
    const name = String(loc.name ?? (loc as any)?.label ?? (loc as any)?.displayName ?? "").trim();
    if (code && name) return `${code} — ${name}`;
    if (name) return name;
    if (code) return code;
    return String(loc.id ?? "Unknown");
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((loc) => {
      const code = String((loc as any)?.code ?? "").toLowerCase();
      const name = String(loc.name ?? (loc as any)?.label ?? "").toLowerCase();
      return code.includes(q) || name.includes(q) || String(loc.id ?? "").toLowerCase().includes(q);
    });
  }, [items, search]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Controls: search + refresh */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code or name (local)"
          disabled={disabled}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button onClick={loadFirstPage} disabled={disabled || loading}>{loading ? "Loading…" : "Refresh"}</button>
        {next ? (
          <button onClick={loadMore} disabled={disabled || loading}>{loading ? "Loading…" : "Load more"}</button>
        ) : null}
      </div>

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
            {filteredItems.map((loc) => {
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
