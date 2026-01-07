import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_MESSAGE_WRITE } from "../generated/permissions";

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

type MessageRecord = {
  id: string;
  channel?: string | null;
  to?: string | null;
  status?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  retryCount?: number | null;
  lastAttemptAt?: string | null;
  sentAt?: string | null;
  queuedAt?: string | null;
  errorMessage?: string | null;
  templateKey?: string | null;
  templateVars?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export default function MessageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { token, tenantId, policy, policyLoading } = useAuth();

  const [msg, setMsg] = useState<MessageRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  const canWrite = hasPerm(policy, PERM_MESSAGE_WRITE) && !policyLoading;
  const backHref = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `/messages?${qs}` : "/messages";
  }, [searchParams]);

  const fetchMessage = async () => {
    if (!id || !token || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<MessageRecord>(`/objects/message/${id}`, {
        token,
        tenantId,
      });
      setMsg(res);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token, tenantId]);

  const handleRetry = async () => {
    if (!id || !canWrite || !token || !tenantId || msg?.status !== "failed") return;
    if (!window.confirm("Retry this failed message?")) return;
    setActionError(null);
    setActionInfo(null);
    try {
      await apiFetch(`/messages/${id}:retry`, {
        method: "POST",
        token,
        tenantId,
      });
      setActionInfo("Retry queued; refreshing...");
      await fetchMessage();
    } catch (err) {
      setActionError(formatError(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <h1>Message Detail</h1>
          <Link to={backHref} style={{ fontSize: 14 }}>
            ← Back to Messages
          </Link>
        </div>
        {msg?.status === "failed" && canWrite && (
          <button onClick={handleRetry} disabled={loading}>
            Retry Failed Message
          </button>
        )}
      </div>

      {actionInfo && <div style={{ padding: 10, background: "#e8f5e9", color: "#1b5e20" }}>{actionInfo}</div>}
      {actionError && <div style={{ padding: 10, background: "#fee", color: "#c00" }}>{actionError}</div>}
      {error && <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 4 }}>{error}</div>}
      {loading && <div>Loading...</div>}

      {msg && !loading && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <Field label="ID" value={msg.id} />
          <Field label="Channel" value={msg.channel} />
          <Field label="To" value={msg.to} />
          <Field label="Status" value={msg.status} />
          <Field label="Provider" value={msg.provider} />
          <Field label="Provider Message ID" value={msg.providerMessageId} />
          <Field label="Retry Count" value={msg.retryCount?.toString()} />
          <Field label="Last Attempt" value={formatDate(msg.lastAttemptAt)} />
          <Field label="Sent At" value={formatDate(msg.sentAt)} />
          <Field label="Queued At" value={formatDate(msg.queuedAt)} />
          <Field label="Error" value={msg.errorMessage} multiline />
          <Field label="Template Key" value={msg.templateKey} />
          <Field label="Template Vars" value={msg.templateVars} multiline isJson />
          <Field label="Metadata" value={msg.metadata} multiline isJson />
        </div>
      )}
    </div>
  );
}

type FieldProps = {
  label: string;
  value?: string | number | null | Record<string, unknown>;
  multiline?: boolean;
  isJson?: boolean;
};

function Field({ label, value, multiline, isJson }: FieldProps) {
  const hasValue = value !== undefined && value !== null && !(typeof value === "string" && value.length === 0);
  const display = isJson ? JSON.stringify(value ?? null, null, 2) : String(value ?? "");
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12, color: "#555" }}>{label}</div>
      {multiline ? (
        <pre
          style={{
            margin: 0,
            padding: 8,
            background: "#f7f7f7",
            border: "1px solid #ddd",
            borderRadius: 4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            minHeight: 40,
          }}
        >
          {hasValue ? display : ""}
        </pre>
      ) : (
        <div
          style={{
            padding: 8,
            background: "#f7f7f7",
            border: "1px solid #ddd",
            borderRadius: 4,
            minHeight: 32,
          }}
        >
          {hasValue ? display : ""}
        </div>
      )}
    </div>
  );
}
