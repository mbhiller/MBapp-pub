import { useEffect, useState } from "react";

/**
 * Line shape with optional client-side stable key.
 * _key is not persisted to API; generated/maintained client-side only.
 * cid is sent to API for new lines (tmp-* prefix).
 */
export type LineInput = {
  id?: string;           // server-assigned id (optional on create)
  cid?: string;          // client id sent to API for new lines (tmp-* prefix)
  _key?: string;         // client-stable key for React rendering (generated if missing, never sent to API)
  itemId: string;
  qty: number;
  uom?: string;
};

export interface LineArrayEditorProps {
  /** Current lines array */
  lines: LineInput[];
  /** Callback when lines change; receives lines WITH _key stripped */
  onChange: (lines: LineInput[]) => void;
  /** Show/hide specific fields (default: all) */
  fields?: ("itemId" | "qty" | "uom")[];
  /** Disable editing */
  disabled?: boolean;
  /** Custom label for item ID column */
  itemIdLabel?: string;
}

/**
 * Generate a stable client-side key for React rendering.
 * Uses crypto.getRandomValues if available, else Math.random fallback.
 */
function generateKey(): string {
  try {
    if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
      const buf = new Uint8Array(8);
      window.crypto.getRandomValues(buf);
      return Array.from(buf)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {}
  // Fallback: use timestamp + random
  return `_key_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate a client-only ID (tmp-* prefix) for new lines.
 * This is sent to API as `cid` so server can track client intent across retries.
 */
function generateCid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
      return `tmp-${(crypto as any).randomUUID()}`;
    }
  } catch {}
  // Fallback if randomUUID is unavailable
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ensure every line has a _key for React rendering and cid for new lines.
 * - _key: Always present (for React key prop)
 * - cid: Added for lines without server id (tmp-* prefix for API tracking)
 */
function ensureKeys(lines: LineInput[]): LineInput[] {
  return lines.map(ln => {
    const hasServerId = ln.id && String(ln.id).trim() && !String(ln.id).trim().startsWith("tmp-");
    return {
      ...ln,
      _key: ln._key ?? generateKey(),
      // Add cid for new lines (no server id yet)
      cid: hasServerId ? ln.cid : (ln.cid ?? generateCid()),
    };
  });
}

/**
 * Strip _key from lines before returning to caller.
 */
function stripKeys(lines: LineInput[]): LineInput[] {
  return lines.map(({ _key, ...rest }) => rest);
}

/**
 * Shared line array editor for Sales Orders, Purchase Orders, etc.
 * Manages client-side stable keys for edit tracking; does NOT send _key to API.
 */
export function LineArrayEditor({
  lines: propLines,
  onChange,
  fields = ["itemId", "qty", "uom"],
  disabled = false,
  itemIdLabel = "Item ID",
}: LineArrayEditorProps) {
  // Internal state with _key ensured
  const [lines, setLines] = useState<LineInput[]>(() => ensureKeys(propLines));

  // Sync with prop changes
  useEffect(() => {
    setLines(ensureKeys(propLines));
  }, [propLines]);

  // Update prop when lines change (strips _key before sending)
  const notifyChange = (updated: LineInput[]) => {
    setLines(updated);
    onChange(stripKeys(updated));
  };

  const addLine = () => {
    const newLine: LineInput = {
      _key: generateKey(),
      cid: generateCid(),  // Add tmp-* cid for new lines (sent to API)
      itemId: "",
      qty: 1,
      uom: fields.includes("uom") ? "ea" : undefined,
    };
    notifyChange([...lines, newLine]);
  };

  const removeLine = (lineKey: string) => {
    notifyChange(lines.filter(ln => ln._key !== lineKey));
  };

  const updateLine = (lineKey: string, patch: Partial<LineInput>) => {
    notifyChange(
      lines.map(ln =>
        ln._key === lineKey ? { ...ln, ...patch, _key: ln._key } : ln
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
            {lines.map(ln => (
              <tr key={ln._key} style={{ borderBottom: "1px solid #eee" }}>
                {fields.includes("itemId") && (
                  <td style={{ padding: 8 }}>
                    <input
                      type="text"
                      value={ln.itemId || ""}
                      onChange={e => updateLine(ln._key!, { itemId: e.target.value })}
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
                      onChange={e => updateLine(ln._key!, { qty: Number(e.target.value) })}
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
                      onChange={e => updateLine(ln._key!, { uom: e.target.value })}
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
                      onClick={() => removeLine(ln._key!)}
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
