import { type FormEvent, useEffect, useState } from "react";
import { LineArrayEditor, type LineInput } from "./LineArrayEditor";
import { validateEditableLines } from "../lib/validateEditableLines";

/**
 * Sales Order Line Input Type
 * 
 * Key Separation Pattern (DO NOT VIOLATE):
 * - id: Server-assigned stable id (L1, L2, ...) - present ONLY for persisted lines
 * - cid: Client temporary id (tmp-*) - present ONLY for new lines not yet saved
 * - _key: UI-only React key (managed by LineArrayEditor, never sent to API)
 * 
 * NEVER:
 * - Generate fallback IDs (e.g., L${idx}) for lines without server id
 * - Send tmp-* values as `id` field (always use `cid`)
 * - Send full line arrays as PUT payload (use computePatchLinesDiff instead)
 */
export type SalesOrderLineInput = {
  id?: string;    // Server-assigned id (present for existing lines)
  cid?: string;   // Client-only temporary id (for new lines before server assigns stable id)
  itemId: string;
  qty: number;
  uom?: string;
};

export type SalesOrderFormValue = {
  partyId: string;
  customerId?: string;
  lines: SalesOrderLineInput[];
  notes?: string;
};

type Props = {
  initialValue?: Partial<SalesOrderFormValue>;
  submitLabel?: string;
  onSubmit: (value: SalesOrderFormValue) => Promise<void> | void;
};

export function SalesOrderForm({ initialValue, submitLabel = "Save", onSubmit }: Props) {
  const [partyId, setPartyId] = useState(initialValue?.partyId ?? "");
  const [customerId, setCustomerId] = useState(initialValue?.customerId ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [lines, setLines] = useState<LineInput[]>(() => {
    if (initialValue?.lines && initialValue.lines.length > 0) {
      return initialValue.lines.map((ln) => ({
        id: ln.id,  // Keep id if present (no fallback)
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
      setPartyId(initialValue.partyId ?? "");
      setCustomerId(initialValue.customerId ?? "");
      setNotes(initialValue.notes ?? "");
      if (initialValue.lines && initialValue.lines.length > 0) {
        setLines(
          initialValue.lines.map((ln) => ({
            id: ln.id,  // Keep id if present (no fallback)
            itemId: ln.itemId || "",
            qty: ln.qty ?? 1,
            uom: ln.uom || "ea",
          }))
        );
      }
    }
  }, [initialValue?.partyId, initialValue?.customerId, initialValue?.notes, initialValue?.lines]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedParty = partyId.trim();
      if (!trimmedParty) throw new Error("partyId is required");

      // Validate lines before processing
      const validation = validateEditableLines(lines);
      if (!validation.ok) {
        throw new Error(validation.message);
      }

      // CRITICAL: Preserve id/cid exactly as provided by LineArrayEditor
      // Do NOT generate synthetic IDs - let computePatchLinesDiff handle identity
      const cleanedLines: SalesOrderLineInput[] = lines.map((ln) => {
        const line: SalesOrderLineInput = {
          itemId: ln.itemId.trim(),
          qty: Number(ln.qty ?? 0),
          uom: (ln.uom || "ea").trim() || "ea",
        };
        // Preserve id or cid (don't generate fallbacks)
        if (ln.id) line.id = String(ln.id).trim();
        if ((ln as any).cid) line.cid = String((ln as any).cid).trim();
        return line;
      });

      // Pass to parent (Edit page will use computePatchLinesDiff, Create page will send as-is)
      await onSubmit({
        partyId: trimmedParty,
        customerId: customerId.trim() || undefined,
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
        <span>Party ID *</span>
        <input value={partyId} onChange={(e) => setPartyId(e.target.value)} placeholder="customer party id" required />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Customer ID (optional)</span>
        <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="legacy customerId" />
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
