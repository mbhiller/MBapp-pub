// apps/mobile/src/screens/ApiProbeScreen.tsx
import React from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { apiClient, listObjects } from "../api/client";

type Jsonish = any;

// Use this if no eventId is passed via route
const DEFAULT_EVENT_ID = "8b323b93-0f3a-4d40-8b53-447fb61c1260";

const Mono = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ fontFamily: "Menlo", color: "#d1d5db", fontSize: 12, lineHeight: 16 }}>
    {children as any}
  </Text>
);

function j(x: Jsonish) {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}
function first<T = any>(arr: T[] | undefined | null): T | undefined {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
}

function extractEventId(reg: any): { id?: string; matchedBy?: string } {
  if (!reg) return {};
  if (reg.eventId) return { id: String(reg.eventId), matchedBy: "eventId" };
  if (reg.event_id) return { id: String(reg.event_id), matchedBy: "event_id" };
  if (reg.event) {
    if (typeof reg.event === "string") return { id: String(reg.event), matchedBy: "event (string)" };
    if (reg.event?.id) return { id: String(reg.event.id), matchedBy: "event.id" };
  }
  if (reg?.meta?.eventId) return { id: String(reg.meta.eventId), matchedBy: "meta.eventId" };
  if (Array.isArray(reg?.refs)) {
    const r = reg.refs.find((r: any) => r?.type === "event" && (r?.id || r?.refId));
    if (r) return { id: String(r.id ?? r.refId), matchedBy: "refs[type=event].{id|refId}" };
  }
  if (Array.isArray(reg?.eventIds) && reg.eventIds.length)
    return { id: String(reg.eventIds[0]), matchedBy: "eventIds[0]" };
  return {};
}

export default function ApiProbeScreen({ route }: any) {
  const [running, setRunning] = React.useState(false);
  const [out, setOut] = React.useState<{
    listEvents?: any;
    pickedEventId?: string;
    getEvent?: any;
    regs_filtered?: Record<string, any>;
    regs_unfiltered_sample?: any[];
    clientCount?: number;
    byKeyHistogram?: Record<string, number>;
  }>({});

  const run = React.useCallback(async () => {
    setRunning(true);
    try {
      // 1) List a few events
      const list = await listObjects<any>("event", { limit: 5, by: "updatedAt", sort: "desc" });
      const items = Array.isArray(list?.items) ? list.items : [];
      const pickedFromRoute = route?.params?.eventId as string | undefined;
      const picked = pickedFromRoute ?? DEFAULT_EVENT_ID ?? first(items)?.id;

      // 2) Get a single event by id
      const one = picked ? await apiClient.get(`/objects/event/${encodeURIComponent(picked)}`) : null;

      // 3) Registrations with different filters (server might ignore filters; we still try)
      const tryFilters: Array<[string, Record<string, any>]> = picked
        ? [
            ["eventId", { limit: 200, by: "updatedAt", sort: "desc", eventId: picked }],
            ["event", { limit: 200, by: "updatedAt", sort: "desc", event: picked }],
            ["event.id", { limit: 200, by: "updatedAt", sort: "desc", "event.id": picked }],
            ["q", { limit: 200, by: "updatedAt", sort: "desc", q: `eventId:${picked}` }],
          ]
        : [];

      const regs_filtered: Record<string, any> = {};
      for (const [label, opts] of tryFilters) {
        try { regs_filtered[label] = await listObjects<any>("registration", opts); }
        catch (e: any) { regs_filtered[label] = { error: String(e?.message ?? e) }; }
      }

      // 4) Unfiltered registrations sample (first 50)
      let regs_unfiltered_sample: any[] = [];
      try {
        const raw = await listObjects<any>("registration", { limit: 50, by: "updatedAt", sort: "desc" });
        const arr = Array.isArray(raw?.items) ? raw.items : [];
        regs_unfiltered_sample = arr.slice(0, 50);
      } catch {}

      // 5) Client-side count & histogram
      const allCandidates: any[] = [];
      for (const v of Object.values(regs_filtered)) {
        const arr = Array.isArray((v as any)?.items) ? (v as any).items : [];
        if (arr.length) allCandidates.push(...arr);
      }
      if (regs_unfiltered_sample.length) allCandidates.push(...regs_unfiltered_sample);

      const hist: Record<string, number> = {};
      let clientCount = 0;
      if (picked) {
        for (const reg of allCandidates) {
          const { id, matchedBy } = extractEventId(reg);
          if (id === picked) {
            clientCount++;
            if (matchedBy) hist[matchedBy] = (hist[matchedBy] ?? 0) + 1;
          }
        }
      }

      setOut({
        listEvents: list,
        pickedEventId: picked,
        getEvent: one,
        regs_filtered,
        regs_unfiltered_sample: regs_unfiltered_sample.slice(0, 5),
        clientCount,
        byKeyHistogram: hist,
      });
    } finally {
      setRunning(false);
    }
  }, [route?.params?.eventId]);

  React.useEffect(() => { run(); }, [run]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#111827", padding: 12 }}>
      <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 8 }}>API Probe</Text>

      <Pressable
        onPress={run}
        style={{ alignSelf: "flex-start", backgroundColor: "#2563eb", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 12 }}
      >
        <Text style={{ color: "white", fontWeight: "700" }}>{running ? "Running…" : "Re-run"}</Text>
      </Pressable>

      <View style={{ marginBottom: 14 }}>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Picked Event ID</Text>
        <Mono>{String(out.pickedEventId ?? "(none)")}</Mono>
      </View>

      <View style={{ marginBottom: 14 }}>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>/objects/event/{`{id}`}</Text>
        <Mono>{j(out.getEvent)}</Mono>
      </View>

      <View style={{ marginBottom: 14 }}>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Registrations — filtered attempts</Text>
        <Mono>{j(out.regs_filtered)}</Mono>
      </View>

      <View style={{ marginBottom: 14 }}>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Registrations — unfiltered sample (first 5)</Text>
        <Mono>{j(out.regs_unfiltered_sample)}</Mono>
      </View>

      <View style={{ marginBottom: 14 }}>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Client count & match histogram</Text>
        <Mono>{j({ clientCount: out.clientCount, byKeyHistogram: out.byKeyHistogram })}</Mono>
      </View>
    </ScrollView>
  );
}
