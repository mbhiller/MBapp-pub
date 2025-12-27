import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../providers/AuthProvider";
import { listVendors, type Vendor } from "../lib/vendors";

type Props = {
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  tenantId?: string; // optional override; defaults to AuthProvider
  token?: string;    // optional override; defaults to AuthProvider
};

export default function VendorPicker({ value, onChange, disabled, tenantId: tOverride, token: tokOverride }: Props) {
  const auth = useAuth();
  const token = tokOverride ?? auth.token ?? undefined;
  const tenantId = tOverride ?? auth.tenantId;
  const [items, setItems] = useState<Vendor[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listVendors({ limit: 200 }, { token, tenantId });
      setItems(res.items ?? []);
      setNext(res.next ?? null);
    } catch (err: any) {
      setError(err?.message || "Failed to load vendors");
    } finally {
      setLoading(false);
    }
  }, [tenantId, token]);

  const loadMore = useCallback(async () => {
    if (!next) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listVendors({ limit: 200, next }, { token, tenantId });
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
    // Only reflect value in <select> if it matches a known vendor id
    const match = items.find((v) => String(v.id ?? "") === String(value ?? ""));
    return match ? String(match.id) : "";
  }, [items, value]);

  const renderLabel = (vendor: Vendor) => {
    const name = String(vendor.name ?? vendor.label ?? vendor.displayName ?? "").trim();
    if (name) return name;
    return String(vendor.id ?? "Unknown");
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((vendor) => {
      const name = String(vendor.name ?? vendor.label ?? vendor.displayName ?? "").toLowerCase();
      return name.includes(q) || String(vendor.id ?? "").toLowerCase().includes(q);
    });
  }, [items, search]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Controls: search + refresh */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by vendor name (local)"
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
          Vendor:
          <select
            value={selectValue}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || loading}
            style={{ minWidth: 200 }}
          >
            <option value="">Select a vendor…</option>
            {filteredItems.map((vendor) => {
              const idStr = String(vendor.id ?? "");
              return (
                <option key={idStr || Math.random().toString(36)} value={idStr}>
                  {idStr} — {renderLabel(vendor)}
                </option>
              );
            })}
          </select>
        </label>
      )}

      {/* Manual entry fallback: always present so user can bypass list */}
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Enter Vendor ID:
        <input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={items.length === 0 ? (loading ? "Loading…" : error ? "Failed to load; enter manually" : "Enter vendor ID") : "Or enter manually"}
          style={{ minWidth: 200 }}
        />
      </label>
    </div>
  );
}
