import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_MESSAGE_READ, PERM_MESSAGE_WRITE } from "../generated/permissions";

const STATUS_OPTIONS = ["", "queued", "sending", "sent", "failed", "cancelled"] as const;
const CHANNEL_OPTIONS = ["", "email", "sms", "push"] as const;

const DEFAULT_LIMIT = 25;
const MAX_BATCH_LIMIT = 50;

type MessageItem = {
  id: string;
  channel?: string | null;
  status?: string | null;
  to?: string | null;
  provider?: string | null;
  retryCount?: number | null;
  lastAttemptAt?: string | null;
  sentAt?: string | null;
  errorMessage?: string | null;
  templateKey?: string | null;
  templateVars?: Record<string, unknown> | null;
};

type MessagePage = {
  items?: MessageItem[];
  next?: string | null;
};

function parseLimit(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), 200);
}

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(String(e.code));
  if (e?.message) parts.push(String(e.message));
  return parts.join(" · ") || "Request failed";
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return String(value);
  }
}

export default function MessagesListPage() {
  const { token, tenantId, policy, policyLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<MessageItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  const statusParam = searchParams.get("status") || "";
  const channelParam = searchParams.get("channel") || "";
  const providerParam = searchParams.get("provider") || "";
  const toParam = searchParams.get("to") || "";
  const limitParam = parseLimit(searchParams.get("limit"));

  const authReady = Boolean(token && tenantId) && !policyLoading;
  const canRead = hasPerm(policy, PERM_MESSAGE_READ);
  const canWrite = hasPerm(policy, PERM_MESSAGE_WRITE);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      if (!authReady || !canRead) return;
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<MessagePage>("/messages", {
          token: token || undefined,
          tenantId,
          query: {
            status: statusParam || undefined,
            channel: channelParam || undefined,
            provider: providerParam || undefined,
            to: toParam || undefined,
            limit: limitParam || undefined,
            next: cursor || undefined,
          },
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items || [])] : res.items || []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [authReady, canRead, statusParam, channelParam, providerParam, toParam, limitParam, tenantId, token]
  );

  useEffect(() => {
    setItems([]);
    setNext(null);
    fetchPage();
  }, [fetchPage]);

  const updateSearchParams = useCallback(
    (updates: Record<string, string | null>) => {
      const nextParams = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          nextParams.delete(key);
        } else {
          nextParams.set(key, value);
        }
      }
      setSearchParams(nextParams, { replace: false });
    },
    [searchParams, setSearchParams]
  );

  const handleApplyFilters = () => {
    setItems([]);
    setNext(null);
    fetchPage();
  };

  const handleReset = () => {
    updateSearchParams({ status: null, channel: null, provider: null, to: null, limit: null });
    setItems([]);
    setNext(null);
  };

  const handleLoadMore = () => {
    if (next) {
      fetchPage(next);
    }
  };

  const retryLimit = useMemo(() => Math.min(limitParam, MAX_BATCH_LIMIT), [limitParam]);

  const handleBatchRetry = async () => {
    if (!canWrite || !authReady) return;
    if (!window.confirm(`Retry up to ${retryLimit} failed messages now?`)) return;
    setActionError(null);
    setActionInfo(null);
    try {
      await apiFetch("/messages:retry-failed", {
        method: "POST",
        token: token || undefined,
        tenantId,
        query: {
          limit: retryLimit,
          channel: channelParam || undefined,
          provider: providerParam || undefined,
        },
      });
      setActionInfo("Batch retry triggered. Refreshing list...");
      setItems([]);
      setNext(null);
      fetchPage();
    } catch (err) {
      setActionError(formatError(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Messages</h1>
        {!canRead && authReady && <span style={{ color: "#c00" }}>Missing permission message:read</span>}
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Status</span>
          <select
            value={statusParam}
            onChange={(e) => updateSearchParams({ status: e.target.value || null })}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt || "any"} value={opt}>
                {opt || "Any"}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Channel</span>
          <select
            value={channelParam}
            onChange={(e) => updateSearchParams({ channel: e.target.value || null })}
          >
            {CHANNEL_OPTIONS.map((opt) => (
              <option key={opt || "any"} value={opt}>
                {opt || "Any"}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Provider</span>
          <input
            value={providerParam}
            onChange={(e) => updateSearchParams({ provider: e.target.value.trim() || null })}
            placeholder="postmark, twilio"
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>To</span>
          <input
            value={toParam}
            onChange={(e) => updateSearchParams({ to: e.target.value.trim() || null })}
            placeholder="email or phone"
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={200}
            value={limitParam}
            onChange={(e) => updateSearchParams({ limit: e.target.value })}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={handleApplyFilters} disabled={loading || !canRead || !authReady}>
          Apply
        </button>
        <button onClick={handleReset} disabled={loading}>
          Reset
        </button>
        {canWrite && (
          <button onClick={handleBatchRetry} disabled={loading || !authReady}>
            Batch Retry Failed
          </button>
        )}
        {actionInfo && <span style={{ color: "#0a0" }}>{actionInfo}</span>}
        {actionError && <span style={{ color: "#c00" }}>{actionError}</span>}
      </div>

      {error && (
        <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>{error}</div>
      )}

      {loading && items.length === 0 && <div>Loading...</div>}

      {!loading && items.length === 0 && !error && (
        <div style={{ padding: 32, textAlign: "center", color: "#666" }}>No messages found.</div>
      )}

      {items.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: "#eee", textAlign: "left" }}>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>ID</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Status</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Channel</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>To</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Provider</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Retry Count</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Last Attempt</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Error</th>
              <th style={{ padding: 8, border: "1px solid #ccc" }}>Template</th>
            </tr>
          </thead>
          <tbody>
            {items.map((msg) => (
              <tr key={msg.id}>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>
                  <Link to={`/messages/${msg.id}`}>{msg.id}</Link>
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{msg.status || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{msg.channel || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{msg.to || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{msg.provider || ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{msg.retryCount ?? ""}</td>
                <td style={{ padding: 8, border: "1px solid #ccc" }}>{formatDate(msg.lastAttemptAt || msg.sentAt)}</td>
                <td style={{ padding: 8, border: "1px solid #ccc", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {msg.errorMessage || ""}
                </td>
                <td style={{ padding: 8, border: "1px solid #ccc", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {msg.templateKey || ""}
                  {msg.templateVars ? ` (${Object.keys(msg.templateVars).join(",")})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {next && (
        <div>
          <button onClick={handleLoadMore} disabled={loading}>
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
