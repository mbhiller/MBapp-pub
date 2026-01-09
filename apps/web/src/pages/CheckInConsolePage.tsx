import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

                return (
                  <TableRow key={reg.id}>
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
