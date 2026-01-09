import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import type { CheckInWorklistPage, Registration } from "../types/checkin";

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

export default function CheckInConsolePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { token, tenantId } = useAuth();

  const [checkedIn, setCheckedIn] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [blockerCode, setBlockerCode] = useState("");
  const [status, setStatus] = useState("confirmed");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Registration[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorklist = useCallback(
    async (cursor?: string) => {
      if (!eventId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<CheckInWorklistPage>(
          `/events/${encodeURIComponent(eventId)}:checkin-worklist`,
          {
            token: token || undefined,
            tenantId,
            query: {
              checkedIn,
              ready: ready ?? undefined,
              blockerCode: blockerCode.trim() || undefined,
              status: status || undefined,
              q: q.trim() || undefined,
              limit: 50,
              next: cursor ?? undefined,
            },
          }
        );
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [eventId, checkedIn, ready, blockerCode, status, q, tenantId, token]
  );

  useEffect(() => {
    fetchWorklist();
  }, [fetchWorklist]);

  const handleRefresh = () => {
    setItems([]);
    setNext(null);
    fetchWorklist();
  };

  const handleFilterChange = (updates: {
    checkedIn?: boolean;
    ready?: boolean | null;
    blockerCode?: string;
    status?: string;
    q?: string;
  }) => {
    if (updates.checkedIn !== undefined) setCheckedIn(updates.checkedIn);
    if (updates.ready !== undefined) setReady(updates.ready);
    if (updates.blockerCode !== undefined) setBlockerCode(updates.blockerCode);
    if (updates.status !== undefined) setStatus(updates.status);
    if (updates.q !== undefined) setQ(updates.q);
    setItems([]);
    setNext(null);
  };

  if (!eventId) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <h1>Check-In Console</h1>
        <div style={{ color: "#b00020", padding: 16, background: "#ffebee", borderRadius: 4 }}>
          Error: Missing event ID. Please navigate to this page with a valid event ID.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>Check-In Console</h1>
          <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>Event ID: {eventId}</div>
        </div>
        <button onClick={handleRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "grid", gap: 12, padding: 16, background: "#f9f9f9", borderRadius: 4 }}>
        {/* Checked In Toggle */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block" }}>
            Check-In Status
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleFilterChange({ checkedIn: false })}
              disabled={loading}
              style={{
                padding: "6px 12px",
                background: !checkedIn ? "#0b3d91" : "#fff",
                color: !checkedIn ? "#fff" : "#333",
                border: "1px solid #ccc",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Not Checked In
            </button>
            <button
              onClick={() => handleFilterChange({ checkedIn: true })}
              disabled={loading}
              style={{
                padding: "6px 12px",
                background: checkedIn ? "#0b3d91" : "#fff",
                color: checkedIn ? "#fff" : "#333",
                border: "1px solid #ccc",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Checked In
            </button>
          </div>
        </div>

        {/* Ready Toggle */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block" }}>
            Readiness
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleFilterChange({ ready: null })}
              disabled={loading}
              style={{
                padding: "6px 12px",
                background: ready === null ? "#0b3d91" : "#fff",
                color: ready === null ? "#fff" : "#333",
                border: "1px solid #ccc",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              All
            </button>
            <button
              onClick={() => handleFilterChange({ ready: true })}
              disabled={loading}
              style={{
                padding: "6px 12px",
                background: ready === true ? "#0b3d91" : "#fff",
                color: ready === true ? "#fff" : "#333",
                border: "1px solid #ccc",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Ready
            </button>
            <button
              onClick={() => handleFilterChange({ ready: false })}
              disabled={loading}
              style={{
                padding: "6px 12px",
                background: ready === false ? "#0b3d91" : "#fff",
                color: ready === false ? "#fff" : "#333",
                border: "1px solid #ccc",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Blocked
            </button>
          </div>
        </div>

        {/* Blocker Code Input */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block" }}>
            Blocker Code (comma-separated)
          </label>
          <input
            type="text"
            value={blockerCode}
            onChange={(e) => setBlockerCode(e.target.value)}
            onBlur={() => handleFilterChange({ blockerCode })}
            placeholder="e.g., payment_unpaid,stalls_unassigned"
            disabled={loading}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4 }}
          />
        </div>

        {/* Status Dropdown */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block" }}>
            Status
          </label>
          <select
            value={status}
            onChange={(e) => handleFilterChange({ status: e.target.value })}
            disabled={loading}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4 }}
          >
            <option value="">Any</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Search Input */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block" }}>
            Search (Party ID, Registration ID)
          </label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => handleFilterChange({ q })}
            placeholder="Search registrations..."
            disabled={loading}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4 }}
          />
        </div>
      </div>

      {/* Error Display */}
      {error ? (
        <div style={{ color: "#b00020", padding: 12, background: "#ffebee", borderRadius: 4 }}>
          {error}
        </div>
      ) : null}

      {/* Loading State */}
      {loading && items.length === 0 ? <div>Loading worklist...</div> : null}

      {/* Empty State */}
      {!loading && items.length === 0 && !error ? (
        <div style={{ color: "#666", padding: 16, textAlign: "center" }}>
          No registrations found for this filter combination.
        </div>
      ) : null}

      {/* Table */}
      {items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#eee", textAlign: "left" }}>
              <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Registration ID</th>
              <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Party ID</th>
              <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Status</th>
              <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Checked In</th>
              <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Ready</th>
              <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Blockers</th>
              <th style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>Last Evaluated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((reg) => {
              const blockers = Array.isArray(reg.checkInStatus?.blockers)
                ? reg.checkInStatus!.blockers!.map((b) => b.code || "?").join(", ")
                : "—";
              const readyDisplay = reg.checkInStatus?.ready === true
                ? "✓"
                : reg.checkInStatus?.ready === false
                ? "✗"
                : "—";
              const checkedInDisplay = reg.checkedInAt ? "✓" : "—";
              const lastEvaluated = reg.checkInStatus?.lastEvaluatedAt
                ? reg.checkInStatus.lastEvaluatedAt.substring(0, 19).replace("T", " ")
                : "—";

              return (
                <tr key={reg.id}>
                  <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{reg.id}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>
                    {reg.partyId || "—"}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>
                    {reg.status || "—"}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12, textAlign: "center" }}>
                    {checkedInDisplay}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12, textAlign: "center" }}>
                    {readyDisplay}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{blockers}</td>
                  <td style={{ padding: 8, border: "1px solid #ccc", fontSize: 12 }}>{lastEvaluated}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {/* Pagination */}
      {next ? (
        <button onClick={() => fetchWorklist(next)} disabled={loading}>
          {loading ? "Loading..." : "Load more"}
        </button>
      ) : null}

      {/* Result Count */}
      {items.length > 0 ? (
        <div style={{ fontSize: 13, color: "#666" }}>
          Showing {items.length} registration{items.length !== 1 ? "s" : ""}
          {next ? " (more available)" : ""}
        </div>
      ) : null}
    </div>
  );
}
