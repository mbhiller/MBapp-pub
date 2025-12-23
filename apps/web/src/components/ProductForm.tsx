import { type FormEvent, useEffect, useState } from "react";

type ProductInput = {
  name: string;
  sku: string;
  type?: string;
  uom?: string;
  price?: number;
  preferredVendorId?: string;
};

type Props = {
  initialValue?: Partial<ProductInput>;
  submitLabel?: string;
  onSubmit: (value: ProductInput) => Promise<void> | void;
};

export function ProductForm({ initialValue, submitLabel = "Save", onSubmit }: Props) {
  const [name, setName] = useState(initialValue?.name ?? "");
  const [sku, setSku] = useState(initialValue?.sku ?? "");
  const [type, setType] = useState(initialValue?.type ?? "good");
  const [uom, setUom] = useState(initialValue?.uom ?? "ea");
  const [price, setPrice] = useState(initialValue?.price?.toString() ?? "");
  const [preferredVendorId, setPreferredVendorId] = useState(initialValue?.preferredVendorId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initialValue?.name ?? "");
    setSku(initialValue?.sku ?? "");
    setType(initialValue?.type ?? "good");
    setUom(initialValue?.uom ?? "ea");
    setPrice(initialValue?.price?.toString() ?? "");
    setPreferredVendorId(initialValue?.preferredVendorId ?? "");
  }, [initialValue?.name, initialValue?.sku, initialValue?.type, initialValue?.uom, initialValue?.price, initialValue?.preferredVendorId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: ProductInput = {
        name: name.trim(),
        sku: sku.trim(),
        type: type.trim() || "good",
        uom: uom.trim() || "ea",
        price: price.trim() ? parseFloat(price.trim()) : undefined,
        preferredVendorId: preferredVendorId.trim() || undefined,
      };
      if (!payload.name) {
        throw new Error("Name is required");
      }
      if (!payload.sku) {
        throw new Error("SKU is required");
      }
      if (payload.price !== undefined && (isNaN(payload.price) || payload.price < 0)) {
        throw new Error("Price must be a non-negative number");
      }
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
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>SKU *</span>
        <input
          type="text"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          required
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="good">Good</option>
          <option value="service">Service</option>
        </select>
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Unit of Measure</span>
        <input
          type="text"
          value={uom}
          placeholder="ea"
          onChange={(e) => setUom(e.target.value)}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Price</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          placeholder="0.00"
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Preferred Vendor ID</span>
        <input
          type="text"
          value={preferredVendorId}
          placeholder="Optional"
          onChange={(e) => setPreferredVendorId(e.target.value)}
        />
      </label>

      {error && (
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
