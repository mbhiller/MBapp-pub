import { useEffect, useState } from "react";
import { generateCid, getOrGenerateLineKey, ensureLineCid } from "../lib/cidGeneration";

/**
 * Line shape for SO/PO editing.
 * id: server-assigned (optional on create; stable L{n} pattern when saved)
 * cid: client-assigned for new lines only (tmp-* prefix; sent to API for idempotency)
 * React key: derived from id (preferred) or cid (fallback); regenerated if missing.
 */
export type LineInput = {
  id?: string;           // server-assigned stable id (L{n} pattern); stable across reloads
  cid?: string;          // client-assigned temporary id (tmp-* prefix); sent to API for new lines
  itemId: string;
  qty: number;
  uom?: string;
};

export interface LineArrayEditorProps {
  /** Current lines array */
  lines: LineInput[];
  /** Callback when lines change */
  onChange: (lines: LineInput[]) => void;
  /** Show/hide specific fields (default: all) */
  fields?: ("itemId" | "qty" | "uom")[];
  /** Disable editing */
  disabled?: boolean;
  /** Custom label for item ID column */
  itemIdLabel?: string;
}

/**
 * Ensure every line has a cid (for new lines without server id).
 * Uses shared cidGeneration utilities.
 */
function ensureCids(lines: LineInput[]): LineInput[] {
  return lines.map(ln => ensureLineCid(ln));
}

/**
 * Get stable React key for a line: prefer server id, else cid.
 * Generates cid if missing (never leaves lines without identity).
 */
function getLineKey(ln: LineInput): string {
  return getOrGenerateLineKey(ln);
}

/**
 * Shared line array editor for Sales Orders, Purchase Orders, etc.
 * Manages stable id/cid for edit tracking; no _key overhead.
 * Every line has a stable React key (id or cid).
 */
export function LineArrayEditor({
  lines: propLines,
  onChange,
  fields = ["itemId", "qty", "uom"],
  disabled = false,
  itemIdLabel = "Item ID",
}: LineArrayEditorProps) {
  // Ensure all lines have cid if missing
  const [lines, setLines] = useState<LineInput[]>(() => ensureCids(propLines));

  // Sync with prop changes; ensure cids
  useEffect(() => {
    setLines(ensureCids(propLines));
  }, [propLines]);

  // Update prop when lines change
  const notifyChange = (updated: LineInput[]) => {
    setLines(updated);
    onChange(updated);
  };

  const addLine = () => {
    const newLine: LineInput = {
      cid: generateCid(),
      itemId: "",
      qty: 1,
      uom: fields.includes("uom") ? "ea" : undefined,
    };
    notifyChange([...lines, newLine]);
  };

  const removeLine = (key: string) => {
    // Filter out the line with matching id or cid
    notifyChange(lines.filter(ln => getLineKey(ln) !== key));
  };

  const updateLine = (key: string, patch: Partial<LineInput>) => {
    notifyChange(
      lines.map(ln =>
        getLineKey(ln) === key ? { ...ln, ...patch } : ln
      )
    );
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Lines</h3>
        {!disabled && (
          <button type="button" onClick={addLine}>
            Add line
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic" }}>No lines</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              {fields.includes("itemId") && (
                <th style={{ textAlign: "left", padding: 8, fontWeight: 600 }}>
                  {itemIdLabel} *
                </th>
              )}
              {fields.includes("qty") && (
                <th style={{ textAlign: "left", padding: 8, fontWeight: 600 }}>
                  Qty *
                </th>
              )}
              {fields.includes("uom") && (
                <th style={{ textAlign: "left", padding: 8, fontWeight: 600 }}>
                  UOM
                </th>
              )}
              <th style={{ textAlign: "right", padding: 8, fontWeight: 600, width: 60 }}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map(ln => {
              const key = getLineKey(ln);
              return (
                <tr key={key} style={{ borderBottom: "1px solid #eee" }}>
                  {fields.includes("itemId") && (
                    <td style={{ padding: 8 }}>
                      <input
                        type="text"
                        value={ln.itemId || ""}
                        onChange={e => updateLine(key, { itemId: e.target.value })}
                        placeholder="e.g., item-123"
                        disabled={disabled}
                        required
                        style={{ width: "100%", padding: 4 }}
                      />
                    </td>
                  )}
                  {fields.includes("qty") && (
                    <td style={{ padding: 8 }}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={ln.qty ?? 0}
                        onChange={e => updateLine(key, { qty: Number(e.target.value) })}
                        disabled={disabled}
                        required
                        style={{ width: 100, padding: 4 }}
                      />
                    </td>
                  )}
                  {fields.includes("uom") && (
                    <td style={{ padding: 8 }}>
                      <input
                        type="text"
                        value={ln.uom || "ea"}
                        onChange={e => updateLine(key, { uom: e.target.value })}
                        placeholder="ea"
                        disabled={disabled}
                        style={{ width: 80, padding: 4 }}
                      />
                    </td>
                  )}
                  <td style={{ padding: 8, textAlign: "right" }}>
                    {!disabled && lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(key)}
                        style={{
                          padding: "2px 8px",
                          fontSize: 12,
                          cursor: "pointer",
                          background: "#fee",
                          border: "1px solid #f88",
                          borderRadius: 3,
                          color: "#d32f2f",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
