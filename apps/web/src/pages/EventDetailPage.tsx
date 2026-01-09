import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "../lib/http";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";

type EventLine = {
  id: string;
  classId: string;
  capacity?: number | null;
  fee?: number | null;
  note?: string | null;
  divisionId?: string | null;
  discipline?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  location?: string | null;
};

type Event = {
  id: string;
  type?: string;
  name: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt?: string;
  status?: string;
  capacity?: number;
  rvEnabled?: boolean;
  rvCapacity?: number;
  rvUnitAmount?: number;
  stallEnabled?: boolean;
  stallCapacity?: number | null;
  stallUnitAmount?: number | null;
  notes?: string;
  lines?: EventLine[];
  createdAt?: string;
  updatedAt?: string;
};

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateRange(start?: string, end?: string | null): string {
  if (!start) return "—";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;
  
  const startStr = startDate.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  
  if (!endDate) return startStr;
  
  const endStr = endDate.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  
  return `${startStr} – ${endStr}`;
}

function formatCurrency(cents?: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function getStatusVariant(status?: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "open":
      return "default";
    case "scheduled":
      return "secondary";
    case "closed":
    case "completed":
      return "outline";
    case "cancelled":
    case "archived":
      return "destructive";
    default:
      return "secondary";
  }
}

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { token, tenantId, policy, policyLoading } = useAuth();

  // Check if user has permissions for check-in console
  const canAccessCheckIn = 
    hasPerm(policy, "event:read") && 
    hasPerm(policy, "registration:read") && 
    !policyLoading;

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    setLoading(true);
    setError(null);

    // For now, fetch via public events list endpoint and filter by ID
    // When authenticated GET /events/:id is added to spec, switch to that
    apiFetch<{ items?: Event[] }>("/events:public", {
      method: "GET",
      tenantId,
      query: { limit: 100 },
    })
      .then((res) => {
        const found = res.items?.find((e) => e.id === eventId);
        if (found) {
          setEvent(found);
        } else {
          setError("Event not found");
        }
      })
      .catch((err) => {
        setError(formatError(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [eventId, tenantId]);

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="py-8 text-center text-muted-foreground">Loading event...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
        <Link to="/events" className="text-sm text-blue-600 hover:underline">
          ← Back to Events
        </Link>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto p-6">
        <p className="mb-4 text-muted-foreground">Event not found.</p>
        <Link to="/events" className="text-sm text-blue-600 hover:underline">
          ← Back to Events
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-4">
        <Link to="/events" className="text-sm text-blue-600 hover:underline">
          ← Back to Events
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold">{event.name}</h1>
          {event.description && (
            <p className="text-muted-foreground">{event.description}</p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => navigate(`/events/${eventId}/my-checkin`)}
            size="lg"
          >
            Check In
          </Button>
          {canAccessCheckIn && (
            <Button
              variant="outline"
              onClick={() => navigate(`/events/${eventId}/checkin`)}
              size="lg"
            >
              Operator Console
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Event Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Location</div>
            <div className="mt-1">{event.location || "—"}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Status</div>
            <div className="mt-1">
              <Badge variant={getStatusVariant(event.status)}>
                {event.status || "—"}
              </Badge>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Date Range</div>
            <div className="mt-1 text-sm">{formatDateRange(event.startsAt, event.endsAt)}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Capacity</div>
            <div className="mt-1">{event.capacity ?? "—"}</div>
          </div>
          {event.rvEnabled && (
            <div>
              <div className="text-sm font-medium text-muted-foreground">RV Spots</div>
              <div className="mt-1">
                {event.rvCapacity ?? "—"} available
                {event.rvUnitAmount != null && <span className="text-muted-foreground"> @ {formatCurrency(event.rvUnitAmount)}</span>}
              </div>
            </div>
          )}
          {event.stallEnabled && (
            <div>
              <div className="text-sm font-medium text-muted-foreground">Stalls</div>
              <div className="mt-1">
                {event.stallCapacity ?? "—"} available
                {event.stallUnitAmount != null && <span className="text-muted-foreground"> @ {formatCurrency(event.stallUnitAmount)}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {event.notes && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.notes}</p>
          </CardContent>
        </Card>
      )}

      {event.lines && event.lines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Event Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class ID</TableHead>
                  <TableHead>Division</TableHead>
                  <TableHead>Discipline</TableHead>
                  <TableHead className="text-right">Capacity</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Scheduled Start</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {event.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-sm">{line.classId}</TableCell>
                    <TableCell>{line.divisionId || "—"}</TableCell>
                    <TableCell>{line.discipline || "—"}</TableCell>
                    <TableCell className="text-right">{line.capacity ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(line.fee)}</TableCell>
                    <TableCell>{line.location || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(line.scheduledStartAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {event.createdAt && (
        <div className="mt-6 text-xs text-muted-foreground">
          Created: {formatDateTime(event.createdAt)}
          {event.updatedAt && ` • Updated: ${formatDateTime(event.updatedAt)}`}
        </div>
      )}
    </div>
  );
}
