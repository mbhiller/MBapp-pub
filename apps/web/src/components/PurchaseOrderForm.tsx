import { type FormEvent, useEffect, useState } from "react";
import { LineArrayEditor, type LineInput } from "./LineArrayEditor";

export type PurchaseOrderLineInput = {
  id: string;
  itemId: string;
  qty: number;
  uom?: string;
};

export type PurchaseOrderFormValue = {
  vendorId: string;
  lines: PurchaseOrderLineInput[];
  notes?: string;
};

type Props = {
  initialValue?: Partial<PurchaseOrderFormValue>;
  submitLabel?: string;
  onSubmit: (value: PurchaseOrderFormValue) => Promise<void> | void;
};

export function PurchaseOrderForm({ initialValue, submitLabel = "Save", onSubmit }: Props) {
  const [vendorId, setVendorId] = useState(initialValue?.vendorId ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [lines, setLines] = useState<LineInput[]>(() => {
    if (initialValue?.lines && initialValue.lines.length > 0) {
      return initialValue.lines.map((ln, idx) => ({
        id: ln.id || `L${idx + 1}`,
        itemId: ln.itemId || "",
        qty: ln.qty ?? 1,
        uom: ln.uom || "ea",
      }));
    }
    return [{ itemId: "", qty: 1, uom: "ea" }];
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialValue) {
      setVendorId(initialValue.vendorId ?? "");
      setNotes(initialValue.notes ?? "");
      if (initialValue.lines && initialValue.lines.length > 0) {
        setLines(
          initialValue.lines.map((ln, idx) => ({
            id: ln.id || `L${idx + 1}`,
            itemId: ln.itemId || "",
            qty: ln.qty ?? 1,
            uom: ln.uom || "ea",
          }))
        );
      }
    }
  }, [initialValue?.vendorId, initialValue?.notes, initialValue?.lines]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedVendor = vendorId.trim();
      if (!trimmedVendor) throw new Error("vendorId is required");

      const cleanedLines: PurchaseOrderLineInput[] = lines
        .map((ln, idx) => ({
          id: (ln.id || `L${idx + 1}`).trim(),
          itemId: ln.itemId.trim(),
          qty: Number(ln.qty ?? 0),
          uom: (ln.uom || "ea").trim() || "ea",
        }))
        .filter((ln) => ln.itemId && ln.qty > 0);

      if (cleanedLines.length === 0) throw new Error("At least one line with itemId and qty>0 is required");

      await onSubmit({
        vendorId: trimmedVendor,
        notes: notes.trim() || undefined,
        lines: cleanedLines,
      });
    } catch (err) {
      const msg = (err as any)?.message ?? "Request failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 720 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span>Vendor ID *</span>
        <input value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="vendor party id" required />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      <LineArrayEditor
        lines={lines}
        onChange={setLines}
        fields={["itemId", "qty", "uom"]}
        disabled={submitting}
        itemIdLabel="Item ID"
      />

      {error ? <div style={{ padding: 12, background: "#fee", color: "#b00020", borderRadius: 4 }}>{error}</div> : null}

      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
