import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import type { CheckInWorklistPage, Registration, ScanResolutionResult, ScanResolutionCandidate } from "../types/checkin";
import { v4 as uuidv4 } from "uuid";

type BadgeIssuance = {
  id: string;
  issuedAt: string;
  issuedBy: string;
};

type NextActionInfo = {
  action: "checkin" | "admit" | "already_admitted" | "blocked" | null;
  ticketId?: string | null;
  ticketStatus?: "valid" | "used" | null;
  ticketUsedAt?: string | null;
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

/**
 * Compute nextAction based on registration and check-in status.
 * Does not require ticket data for initial guess (ticket state optional).
 */
function computeNextAction(reg: Registration, ticketInfo?: NextActionInfo): NextActionInfo {
  const isCheckedIn = !!(reg as any)?.checkedInAt;
  const checkInStatus = (reg as any)?.checkInStatus;
  const isReady = checkInStatus?.ready === true;
  const isBlocked = checkInStatus?.ready === false;

  // If ticket info already known, use it
  if (ticketInfo) {
    return ticketInfo;
  }

  // Default logic without ticket data
  if (isBlocked) {
    return { action: "blocked" };
  }
  if (!isCheckedIn) {
    return { action: "checkin" };
  }

  return { action: null };
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

  // Badge issuance state
  const [badges, setBadges] = useState<Record<string, BadgeIssuance>>({});
  const [issuingBadgeId, setIssuingBadgeId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Action state per registration
  const [nextActions, setNextActions] = useState<Record<string, NextActionInfo>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Scan mode state
  const [scanString, setScanString] = useState("");
  const [resolving, setResolving] = useState(false);
  const [scanBanner, setScanBanner] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [ambiguous, setAmbiguous] = useState<ScanResolutionCandidate[] | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lastResolve, setLastResolve] = useState<ScanResolutionResult | null>(null);
  const [lastScanString, setLastScanString] = useState<string>("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

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

  // Apply a specific registrationId to the filter and refetch first page, with highlight
  const applyResolvedRegistration = async (registrationId: string) => {
    setQ(registrationId);
    setItems([]);
    setNext(null);
    setHighlightId(registrationId);
    await fetchWorklist();
    // Clear highlight after a brief period
    window.setTimeout(() => setHighlightId((hid) => (hid === registrationId ? null : hid)), 2500);
  };

  // Resolve scan via API
  const handleScanResolve = async () => {
    if (!eventId) return;
    const s = scanString.trim();
    if (!s) return;
    setResolving(true);
    setScanBanner(null);
    setAmbiguous(null);
    try {
      const res = await apiFetch<ScanResolutionResult>("/registrations:resolve-scan", {
        method: "POST",
        token: token || undefined,
        tenantId,
        body: { eventId, scanString: s, scanType: "auto" },
      });
      if (res && (res as any).ok === true) {
        const okRes = res as Extract<ScanResolutionResult, { ok: true }>;
        setLastResolve(okRes);
        setLastScanString(s);
        setScanBanner({ kind: "success", message: `Matched registration ${okRes.registrationId}${okRes.partyId ? ` (party ${okRes.partyId})` : ""}` });
        setScanString("");
        await applyResolvedRegistration(okRes.registrationId);
      } else {
        const errRes = res as Extract<ScanResolutionResult, { ok: false }>;
        if (errRes.error === "ambiguous" && Array.isArray(errRes.candidates) && errRes.candidates.length > 0) {
          setAmbiguous(errRes.candidates);
          setScanBanner({ kind: "error", message: `Ambiguous: ${errRes.reason || "multiple candidates"}` });
        } else {
          setScanBanner({ kind: "error", message: `${errRes.error}: ${errRes.reason}` });
        }
        // Focus back to input for retry
        scanInputRef.current?.focus();
      }
    } catch (err) {
      setScanBanner({ kind: "error", message: formatError(err) });
      scanInputRef.current?.focus();
    } finally {
      setResolving(false);
    }
  };

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleScanResolve();
    }
  };

  const clearScanFilter = () => {
    setScanBanner(null);
    setAmbiguous(null);
    if (q.trim()) {
      setQ("");
      setItems([]);
      setNext(null);
      fetchWorklist();
    }
    scanInputRef.current?.focus();
  };

  const handleIssueBadge = async (registrationId: string) => {
    setIssuingBadgeId(registrationId);
    setToast(null);
    try {
      const idempotencyKey = uuidv4();
      const res = await apiFetch<{ issuance: BadgeIssuance }>(
        `/registrations/${encodeURIComponent(registrationId)}:issue-badge`,
        {
          method: "POST",
          token: token || undefined,
          tenantId,
          body: { badgeType: "admission" },
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
        }
      );
      if (res?.issuance) {
        setBadges((prev) => ({ ...prev, [registrationId]: res.issuance }));
        setToast({ kind: "success", message: `Badge issued for registration ${registrationId}` });
      } else {
        setToast({ kind: "error", message: "Badge issued but response was invalid" });
      }
    } catch (err: any) {
      const errMsg = err?.code === "not_checked_in"
        ? "Registration must be checked in first"
        : err?.code === "checkin_blocked"
        ? `Badge blocked: ${err?.message || "registration not ready"}`
        : formatError(err);
      setToast({ kind: "error", message: `Failed to issue badge: ${errMsg}` });
    } finally {
      setIssuingBadgeId(null);
    }
  };

  const handleCheckIn = async (registrationId: string) => {
    setCheckingIn(true);
    setToast(null);
    setActionLoading((prev) => ({ ...prev, [registrationId]: true }));
    try {
      const idempotencyKey = `web-ci-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = await apiFetch<{ checkedInAt: string }>(
        `/events/registration/${encodeURIComponent(registrationId)}:checkin`,
        {
          method: "POST",
          token: token || undefined,
          tenantId,
          body: {},
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
        }
      );
      if (res?.checkedInAt) {
        setToast({ kind: "success", message: `Checked in registration ${registrationId}` });
        // Refresh worklist and clear next actions so they are recomputed
        setNextActions((prev) => {
          const updated = { ...prev };
          delete updated[registrationId];
          return updated;
        });
        await fetchWorklist();
        // Re-resolve to update nextAction if scanning
        if (lastScanString) {
          const resolveRes = await apiFetch<ScanResolutionResult>("/registrations:resolve-scan", {
            method: "POST",
            token: token || undefined,
            tenantId,
            body: { eventId, scanString: lastScanString, scanType: "auto" },
          });
          if (resolveRes && (resolveRes as any).ok === true) {
            const okRes = resolveRes as Extract<ScanResolutionResult, { ok: true }>;
            setLastResolve(okRes);
          }
        }
      } else {
        setToast({ kind: "error", message: "Check-in succeeded but response was invalid" });
      }
    } catch (err: any) {
      const errMsg = err?.code === "checkin_blocked"
        ? "Registration is not ready to check in"
        : err?.code === "already_checked_in"
        ? "Registration is already checked in"
        : err?.code === "not_found"
        ? "Registration not found"
        : formatError(err);
      setToast({ kind: "error", message: `Failed to check in: ${errMsg}` });
    } finally {
      setCheckingIn(false);
      setActionLoading((prev) => ({ ...prev, [registrationId]: false }));
    }
  };

  const handleAdmit = async (ticketId: string, registrationId?: string) => {
    setAdmitting(true);
    setToast(null);
    if (registrationId) {
      setActionLoading((prev) => ({ ...prev, [registrationId]: true }));
    }
    try {
      const idempotencyKey = `web-admit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = await apiFetch<{ usedAt: string }>(
        `/tickets/${encodeURIComponent(ticketId)}:use`,
        {
          method: "POST",
          token: token || undefined,
          tenantId,
          body: {},
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
        }
      );
      if (res?.usedAt) {
        setToast({ kind: "success", message: `Admitted ticket ${ticketId}` });
        // Refresh worklist and clear next actions so they are recomputed
        if (registrationId) {
          setNextActions((prev) => {
            const updated = { ...prev };
            delete updated[registrationId];
            return updated;
          });
        }
        await fetchWorklist();
        // Re-resolve to update nextAction if scanning
        if (lastScanString) {
          const resolveRes = await apiFetch<ScanResolutionResult>("/registrations:resolve-scan", {
            method: "POST",
            token: token || undefined,
            tenantId,
            body: { eventId, scanString: lastScanString, scanType: "auto" },
          });
          if (resolveRes && (resolveRes as any).ok === true) {
            const okRes = resolveRes as Extract<ScanResolutionResult, { ok: true }>;
            setLastResolve(okRes);
          }
        }
      } else {
        setToast({ kind: "error", message: "Admission succeeded but response was invalid" });
      }
    } catch (err: any) {
      const errMsg = err?.code === "ticket_already_used"
        ? "Ticket is already admitted"
        : err?.code === "ticket_not_valid"
        ? "Ticket is not valid for admission"
        : err?.code === "not_found"
        ? "Ticket not found"
        : formatError(err);
      setToast({ kind: "error", message: `Failed to admit: ${errMsg}` });
    } finally {
      setAdmitting(false);
      if (registrationId) {
        setActionLoading((prev) => ({ ...prev, [registrationId]: false }));
      }
    }
  };

  const handleScanNext = () => {
    setScanString("");
    setLastResolve(null);
    setHighlightId(null);
    setScanBanner(null);
    setAmbiguous(null);
    scanInputRef.current?.focus();
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
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Check-In Console</h1>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Error: Missing event ID. Please navigate to this page with a valid event ID.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold leading-tight">Check-In Console</h1>
          <p className="text-sm text-slate-600">Event ID: {eventId}</p>
        </div>
        <Button onClick={handleRefresh} disabled={loading} size="sm">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {/* Scan mode */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Scan</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              ref={scanInputRef}
              placeholder="Scan or paste registration QR / ID"
              value={scanString}
              onChange={(e) => setScanString(e.target.value)}
              onKeyDown={handleScanKeyDown}
              disabled={resolving || loading}
            />
            <div className="flex gap-2">
              <Button onClick={handleScanResolve} disabled={resolving || loading || !scanString.trim()}>
                {resolving ? "Resolving..." : "Resolve"}
              </Button>
              {lastResolve?.ok ? (
                <Button variant="outline" onClick={handleScanNext} disabled={resolving || loading}>
                  Scan Next
                </Button>
              ) : null}
              {q.trim() ? (
                <Button variant="outline" onClick={clearScanFilter} disabled={resolving || loading}>Clear scan filter</Button>
              ) : null}
            </div>
          </div>

          {scanBanner ? (
            <div
              className={
                scanBanner.kind === "success"
                  ? "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"
                  : "rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800"
              }
            >
              <div>{scanBanner.message}</div>
              {lastResolve?.ok && lastResolve.ticketId ? (
                <div className="mt-1 text-xs">
                  Ticket: {lastResolve.ticketId} (status={lastResolve.ticketStatus || "unknown"})
                  {lastResolve.ticketUsedAt ? ` · Admitted ${new Date(lastResolve.ticketUsedAt).toLocaleString()}` : ""}
                </div>
              ) : null}
            </div>
          ) : null}

          {ambiguous && ambiguous.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="mb-2 text-sm font-medium text-amber-900">Multiple matches — choose one:</div>
              <div className="flex flex-col gap-2">
                {ambiguous.map((c) => (
                  <div key={c.registrationId} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200">
                    <div className="flex flex-col">
                      <span className="font-mono text-xs text-slate-800">{c.registrationId}</span>
                      <span className="text-xs text-slate-600">{c.partyId || "—"} • {c.status}</span>
                    </div>
                    <Button size="sm" onClick={() => applyResolvedRegistration(c.registrationId)} disabled={resolving || loading}>
                      Select
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {toast ? (
        <div
          className={
            toast.kind === "success"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              : "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          }
        >
          {toast.message}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Check-In Status</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={!checkedIn ? "default" : "outline"}
                size="sm"
                onClick={() => handleFilterChange({ checkedIn: false })}
                disabled={loading}
              >
                Not Checked In
              </Button>
              <Button
                variant={checkedIn ? "default" : "outline"}
                size="sm"
                onClick={() => handleFilterChange({ checkedIn: true })}
                disabled={loading}
              >
                Checked In
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Readiness</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={ready === null ? "default" : "outline"}
                size="sm"
                onClick={() => handleFilterChange({ ready: null })}
                disabled={loading}
              >
                All
              </Button>
              <Button
                variant={ready === true ? "default" : "outline"}
                size="sm"
                onClick={() => handleFilterChange({ ready: true })}
                disabled={loading}
              >
                Ready
              </Button>
              <Button
                variant={ready === false ? "default" : "outline"}
                size="sm"
                onClick={() => handleFilterChange({ ready: false })}
                disabled={loading}
              >
                Blocked
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="blocker-code">Blocker Code (comma-separated)</Label>
            <Input
              id="blocker-code"
              value={blockerCode}
              onChange={(e) => setBlockerCode(e.target.value)}
              onBlur={() => handleFilterChange({ blockerCode })}
              placeholder="e.g., payment_unpaid,stalls_unassigned"
              disabled={loading}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="status-select">Status</Label>
            <select
              id="status-select"
              value={status}
              onChange={(e) => handleFilterChange({ status: e.target.value })}
              disabled={loading}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Any</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="search-input">Search (Party ID, Registration ID)</Label>
            <Input
              id="search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => handleFilterChange({ q })}
              placeholder="Search registrations..."
              disabled={loading}
            />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          Loading worklist...
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-8 text-center text-slate-600">
          No registrations found for this filter combination.
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs uppercase">Registration ID</TableHead>
                <TableHead className="text-xs uppercase">Party ID</TableHead>
                <TableHead className="text-xs uppercase">Status</TableHead>
                <TableHead className="text-xs uppercase text-center">Checked In</TableHead>
                <TableHead className="text-xs uppercase text-center">Ready</TableHead>
                <TableHead className="text-xs uppercase">Blockers</TableHead>
                <TableHead className="text-xs uppercase">Actions</TableHead>
                <TableHead className="text-xs uppercase">Badge</TableHead>
                <TableHead className="text-xs uppercase">Last Evaluated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((reg) => {
                const blockers = Array.isArray(reg.checkInStatus?.blockers)
                  ? reg.checkInStatus.blockers!.map((b) => b.code || "?").join(", ")
                  : "—";
                const readyState = reg.checkInStatus?.ready;
                const readyDisplay = readyState === true ? "Ready" : readyState === false ? "Blocked" : "—";
                const readyVariant = readyState === true ? "success" : readyState === false ? "destructive" : "secondary";
                const checkedInDisplay = reg.checkedInAt ? "Yes" : "No";
                const checkedInVariant = reg.checkedInAt ? "success" : "secondary";
                const lastEvaluated = reg.checkInStatus?.lastEvaluatedAt
                  ? reg.checkInStatus.lastEvaluatedAt.substring(0, 19).replace("T", " ")
                  : "—";

                const isResolvedRow = lastResolve?.ok && lastResolve.registrationId === reg.id;
                const isHighlighted = highlightId && reg.id === highlightId;
                const badge = badges[reg.id];
                const isBadgeIssuing = issuingBadgeId === reg.id;
                const isRowActionLoading = actionLoading[reg.id] || false;

                // Get nextAction from API response or fallback to scan/computation
                let nextActionInfo: NextActionInfo;
                const apiNextAction = (reg as any)?.nextAction as string | null | undefined;
                
                if (isResolvedRow && lastResolve.ok) {
                  // Prefer resolved scan data if available for this row
                  nextActionInfo = {
                    action: lastResolve.nextAction || null,
                    ticketId: lastResolve.ticketId,
                    ticketStatus: lastResolve.ticketStatus,
                    ticketUsedAt: lastResolve.ticketUsedAt,
                  };
                } else if (apiNextAction) {
                  // Use enriched data from worklist API
                  nextActionInfo = {
                    action: apiNextAction as "checkin" | "admit" | "already_admitted" | "blocked" | null,
                    ticketId: (reg as any)?.ticketId || null,
                    ticketStatus: (reg as any)?.ticketStatus as "valid" | "used" | null | undefined,
                    ticketUsedAt: (reg as any)?.ticketUsedAt || null,
                  };
                } else {
                  // Fallback to cached or computed value
                  nextActionInfo = nextActions[reg.id] || computeNextAction(reg);
                }

                // Render actions for all rows
                let actionsDisplay: React.ReactNode = "—";
                
                if (nextActionInfo.action === "checkin") {
                  actionsDisplay = (
                    <Button
                      size="sm"
                      onClick={() => handleCheckIn(reg.id)}
                      disabled={isRowActionLoading || readyState === false}
                      title={readyState === false ? "Registration not ready" : "Check in this registration"}
                    >
                      {isRowActionLoading ? "Checking In..." : "Check In"}
                    </Button>
                  ) as any;
                } else if (nextActionInfo.action === "admit" && nextActionInfo.ticketId) {
                  actionsDisplay = (
                    <Button
                      size="sm"
                      onClick={() => handleAdmit(nextActionInfo.ticketId!, reg.id)}
                      disabled={isRowActionLoading}
                      title="Admit this ticket"
                    >
                      {isRowActionLoading ? "Admitting..." : "Admit"}
                    </Button>
                  ) as any;
                } else if (nextActionInfo.action === "already_admitted") {
                  const usedAtStr = nextActionInfo.ticketUsedAt
                    ? new Date(nextActionInfo.ticketUsedAt).toLocaleString()
                    : "unknown";
                  actionsDisplay = (
                    <div className="text-xs">
                      <Badge variant="success">Admitted</Badge>
                      <div className="mt-1 text-slate-600">{usedAtStr}</div>
                    </div>
                  ) as any;
                } else if (nextActionInfo.action === "blocked") {
                  const topBlockers = Array.isArray(reg.checkInStatus?.blockers)
                    ? (reg.checkInStatus.blockers || []).slice(0, 2)
                    : [];
                  actionsDisplay = (
                    <div className="text-xs">
                      <Badge variant="destructive">Blocked</Badge>
                      {topBlockers.length > 0 ? (
                        <div className="mt-1 text-slate-600">
                          {topBlockers.map((b) => b.code || "?").join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ) as any;
                }

                return (
                  <TableRow key={reg.id} className={isHighlighted ? "bg-yellow-50" : undefined}>
                    <TableCell className="font-mono text-xs text-slate-800">{reg.id}</TableCell>
                    <TableCell className="text-xs text-slate-700">{reg.partyId || "—"}</TableCell>
                    <TableCell className="text-xs text-slate-700">{reg.status || "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={checkedInVariant}>{checkedInDisplay}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={readyVariant}>{readyDisplay}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">{blockers}</TableCell>
                    <TableCell>
                      {typeof actionsDisplay === "string" ? (
                        <span className="text-xs text-slate-600">{actionsDisplay}</span>
                      ) : (
                        actionsDisplay
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {badge ? (
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant="success">Issued</Badge>
                          <span className="font-mono text-xs text-slate-600">
                            {badge.issuedAt.substring(11, 19)}
                          </span>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleIssueBadge(reg.id)}
                          disabled={isBadgeIssuing || !reg.checkedInAt}
                          title={!reg.checkedInAt ? "Registration must be checked in first" : "Issue badge"}
                        >
                          {isBadgeIssuing ? "Issuing..." : "Issue"}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{lastEvaluated}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {next ? (
        <div className="flex justify-center">
          <Button onClick={() => fetchWorklist(next)} disabled={loading} variant="outline">
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <p className="text-sm text-slate-600">
          Showing {items.length} registration{items.length !== 1 ? "s" : ""}
          {next ? " (more available)" : ""}
        </p>
      ) : null}
    </div>
  );
}
