import { Link } from "react-router-dom";

export type MovementRow = {
  id: string;
  itemId?: string;
  action?: string;
  qty?: number;
  createdAt?: string;
  note?: string;
  locationId?: string;
  lot?: string;
  at?: string;
  refId?: string;
  poLineId?: string;
};

type Props = {
  movements: MovementRow[];
  showItemId?: boolean;
  emptyText?: string;
};

export default function MovementsTable({ movements, showItemId = false, emptyText = "No movements found." }: Props) {
  if (movements.length === 0) {
    return <div style={{ color: "#666", marginBottom: 16 }}>{emptyText}</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
      <thead>
        <tr style={{ background: "#eee", textAlign: "left" }}>
          <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Timestamp</th>
          {showItemId && <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Item ID</th>}
          <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Action</th>
          <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Qty</th>
          <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Lot</th>
          <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Location ID</th>
          <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Ref ID</th>
          <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>PO Line ID</th>
        </tr>
      </thead>
      <tbody>
        {movements.map((m) => (
          <tr key={m.id}>
            <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>
              {(m.at || m.createdAt || "").substring(0, 19)}
            </td>
            {showItemId && (
              <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>
                {m.itemId ? (
                  <Link to={`/inventory/${encodeURIComponent(m.itemId)}`} style={{ color: "#08a" }}>
                    {m.itemId}
                  </Link>
                ) : (
                  ""
                )}
              </td>
            )}
            <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{m.action || ""}</td>
            <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12, textAlign: "right" }}>
              {m.qty ?? ""}
            </td>
            <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{m.lot || ""}</td>
            <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{m.locationId || ""}</td>
            <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{m.refId || ""}</td>
            <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{m.poLineId || ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
