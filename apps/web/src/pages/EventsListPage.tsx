import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../lib/http";

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
  createdAt?: string;
  updatedAt?: string;
};

type EventPage = { items?: Event[]; next?: string | null };

function formatError(err: unknown): string {
  const e = err as any;
  const parts: string[] = [];
  if (e?.status) parts.push(`status ${e.status}`);
  if (e?.code) parts.push(e.code);
  if (e?.message) parts.push(e.message);
  return parts.join(" · ") || "Request failed";
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { 
    dateStyle: "medium", 
    timeStyle: "short" 
  });
}

function formatDateRange(start?: string, end?: string): string {
  if (!start) return "—";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;
  
  const startStr = startDate.toLocaleString(undefined, { 
    dateStyle: "medium", 
    timeStyle: "short" 
  });
  
  if (!endDate) return startStr;
  
  const endStr = endDate.toLocaleString(undefined, { 
    dateStyle: "medium", 
    timeStyle: "short" 
  });
  
  return `${startStr} – ${endStr}`;
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

export default function EventsListPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState<Event[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("open");

  const queryParams = useMemo(() => {
    const q: Record<string, string | number | boolean | undefined> = {
      limit: 25,
    };
    if (statusFilter && statusFilter !== "all") {
      q.status = statusFilter;
    }
    return q;
  }, [statusFilter]);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<EventPage>("/events:public", {
          method: "GET",
          query: { ...queryParams, next: cursor ?? undefined },
        });
        setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNext(res.next ?? null);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setLoading(false);
      }
    },
    [queryParams]
  );

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleRowClick = (eventId: string) => {
    navigate(`/events/${eventId}`);
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Events</h1>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Label>Status</Label>
            <div className="flex flex-wrap gap-2">
              {["all", "draft", "scheduled", "open", "closed", "completed", "cancelled", "archived"].map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                  disabled={loading}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select an event to view details and use My Check-In.
          </p>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">Loading events...</div>
      )}

      {items.length === 0 && !loading && (
        <div className="py-8 text-center text-muted-foreground">No events found.</div>
      )}

      {items.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Date Range</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((evt) => (
                <TableRow
                  key={evt.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(evt.id)}
                >
                  <TableCell className="font-medium">{evt.name}</TableCell>
                  <TableCell>{evt.location || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateRange(evt.startsAt, evt.endsAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(evt.status)}>
                      {evt.status || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{evt.capacity ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {next && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => fetchPage(next)} disabled={loading} variant="outline">
            {loading ? "Loading..." : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
}
