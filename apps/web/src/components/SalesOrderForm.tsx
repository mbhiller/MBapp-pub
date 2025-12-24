import { type FormEvent, useEffect, useState } from "react";

export type SalesOrderLineInput = {
  id: string;
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

function newLine(n: number): SalesOrderLineInput {
  return { id: `L${n}`, itemId: "", qty: 1, uom: "ea" };
}

export function SalesOrderForm({ initialValue, submitLabel = "Save", onSubmit }: Props) {
  const [partyId, setPartyId] = useState(initialValue?.partyId ?? "");
  const [customerId, setCustomerId] = useState(initialValue?.customerId ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [lines, setLines] = useState<SalesOrderLineInput[]>(() => {
    if (initialValue?.lines && initialValue.lines.length > 0) {
      return initialValue.lines.map((ln, idx) => ({
        id: ln.id || `L${idx + 1}`,
        itemId: ln.itemId || "",
        qty: ln.qty ?? 1,
        uom: ln.uom || "ea",
      }));
    }
    return [newLine(1)];
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
          initialValue.lines.map((ln, idx) => ({
            id: ln.id || `L${idx + 1}`,
            itemId: ln.itemId || "",
            qty: ln.qty ?? 1,
            uom: ln.uom || "ea",
          }))
        );
      }
    }
  }, [initialValue?.partyId, initialValue?.customerId, initialValue?.notes, initialValue?.lines]);

  const updateLine = (idx: number, patch: Partial<SalesOrderLineInput>) => {
    setLines((prev) => prev.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)));
  };

  const addLine = () => {
    setLines((prev) => [...prev, newLine(prev.length + 1)]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedParty = partyId.trim();
      if (!trimmedParty) throw new Error("partyId is required");

      const cleanedLines: SalesOrderLineInput[] = lines
        .map((ln, idx) => ({
          id: (ln.id || `L${idx + 1}`).trim(),
          itemId: ln.itemId.trim(),
          qty: Number(ln.qty ?? 0),
          uom: (ln.uom || "ea").trim() || "ea",
        }))
        .filter((ln) => ln.itemId && ln.qty > 0);

      if (cleanedLines.length === 0) throw new Error("At least one line with itemId and qty>0 is required");

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

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Lines</h3>
          <button type="button" onClick={addLine}>Add line</button>
        </div>
        {lines.map((ln, idx) => (
          <div key={idx} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ display: "grid", gap: 4, flex: 1 }}>
                <span>Line ID</span>
                <input value={ln.id} onChange={(e) => updateLine(idx, { id: e.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 4, flex: 1 }}>
                <span>Item ID *</span>
                <input value={ln.itemId} onChange={(e) => updateLine(idx, { itemId: e.target.value })} required />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Qty *</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={ln.qty}
                  onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                  required
                  style={{ width: 120 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>UOM</span>
                <input value={ln.uom} onChange={(e) => updateLine(idx, { uom: e.target.value })} style={{ width: 120 }} />
              </label>
            </div>
            {lines.length > 1 ? (
              <button type="button" onClick={() => removeLine(idx)} style={{ alignSelf: "flex-start" }}>
                Remove line
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {error ? <div style={{ padding: 12, background: "#fee", color: "#b00020", borderRadius: 4 }}>{error}</div> : null}

      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
