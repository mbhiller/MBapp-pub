// apps/mobile/src/screens/DevEventsToolsScreen.tsx
import React from "react";
import { ScrollView, View, Text, Pressable, Alert, TextInput, Platform } from "react-native";
import { listObjects, apiClient, type ListPage } from "../api/client"; // adjust import if your path differs

async function deleteObject(type: string, id: string) {
  await apiClient.del(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
}

type Base = { id?: string; type: string; createdAt?: string; updatedAt?: string; externalId?: string };

type AccountRow   = Base & { type: "account";  name?: string; number?: string; accountType?: string; currency?: string; balance?: number; status?: "active" | "inactive" | "archived"; };
type ClientRow    = Base & { type: "client";   name?: string; displayName?: string; firstName?: string; lastName?: string; email?: string; phone?: string; status?: "active" | "inactive" | "archived"; notes?: string; };
type ProductRow   = Base & { type: "product";  name?: string; kind?: "good" | "service"; sku?: string; price?: number; taxCode?: string; status?: "active" | "inactive" | "archived"; notes?: string; };
type InventoryRow = Base & { type: "inventory"; productId?: string; name?: string; sku?: string; quantity?: number; uom?: string; location?: string; minQty?: number; maxQty?: number; status?: "active" | "inactive" | "archived"; notes?: string; };
type ResourceRow  = Base & { type: "resource"; name?: string; code?: string; url?: string; expiresAt?: string; };
type EventRow     = Base & { type: "event";    name: string; description?: string; location?: string; startsAt: string; endsAt?: string; status?: "available" | "unavailable" | "maintenance"; capacity?: number; };
type RegistrationRow = Base & { type: "registration"; eventId: string; clientId?: string; startsAt?: string; endsAt?: string; status?: "pending"|"confirmed"|"cancelled"|"checked_in"|"completed"; registeredAt?: string; notes?: string; };
type ReservationRow  = Base & { type: "reservation"; resourceId: string; start?: string; end?: string; startsAt?: string; endsAt?: string; clientId?: string; status?: "pending"|"confirmed"|"cancelled"|"checked_in"|"completed"; notes?: string; };
type VendorRow    = Base & { type: "vendor";   name: string; displayName?: string; email?: string; phone?: string; notes?: string; status?: "active" | "inactive" | "archived"; };
type EmployeeRow  = Base & { type: "employee"; displayName: string; email?: string; phone?: string; role?: string; status?: "active" | "inactive" | "terminated"; hiredAt?: string; startDate?: string; terminatedAt?: string; notes?: string; };

const now = Date.now();
const iso = (t: number) => new Date(t).toISOString();
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
const Mono = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: "#d1d5db", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 16 }}>{children as any}</Text>
);
const j = (x: any) => { try { return JSON.stringify(x, null, 2); } catch { return String(x); } };
const Label = ({ children }: { children: React.ReactNode }) => <Text style={{ color: "#9ca3af", marginBottom: 4 }}>{children as any}</Text>;
const Box = (props: any) => (
  <TextInput
    {...props}
    style={[{
      borderWidth: 1, borderColor: "#374151", borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 8, color: "#e5e7eb",
      backgroundColor: "#111827", marginBottom: 8,
    }, props.style]}
    placeholderTextColor="#6b7280"
  />
);

// wipe (paged)
async function wipeType(type: string) {
  let next: string | undefined = undefined;
  for (let i = 0; i < 200; i++) {
    const page: ListPage<Base> = await listObjects<Base>(type, { limit: 200, next, by: "updatedAt", sort: "desc" });
    const items: Base[] = Array.isArray(page?.items) ? page.items : [];
    for (const it of items) if (it.id) await deleteObject(type, it.id);
    next = (page as any)?.next ?? undefined;
    if (!next) break;
  }
}

// bulk POST
async function postAll<T extends Base>(type: string, rows: Omit<T, "id">[]): Promise<T[]> {
  const out: T[] = [];
  for (const row of rows) out.push(await apiClient.post<T>(`/objects/${encodeURIComponent(type)}`, row));
  return out;
}

// generators
function genAccounts(): Omit<AccountRow, "id">[] {
  const currencies = ["USD","EUR","GBP","JPY","CAD"], types = ["asset","liability","revenue","expense","equity"];
  return Array.from({ length: 5 }, (_, i) => ({ type:"account", name:`Account ${i+1}`, number:`ACCT-${1000+i}`, accountType:pick(types,i), currency:pick(currencies,i), balance:(i+1)*1000, status:i%4===3?"archived":"active" }));
}
function genClients(): Omit<ClientRow, "id">[] {
  return Array.from({ length: 5 }, (_, i) => ({ type:"client", name:`Client ${i+1}`, displayName:`C${i+1}`, firstName:`First${i+1}`, lastName:`Last${i+1}`, email:`client${i+1}@example.test`, phone:`+1-555-01${(10+i).toString().padStart(2,"0")}`, status:i%4===3?"archived":"active", notes:i%2?"Preferred":"—" }));
}
function genProducts(): Omit<ProductRow, "id">[] {
  return Array.from({ length: 5 }, (_, i) => ({ type:"product", name:i%2?`Service Tier ${i+1}`:`Widget ${i+1}`, kind:i%2?"service":"good", sku:`SKU-${(i+1).toString().padStart(3,"0")}`, price:(i+1)*25, taxCode:i%2?"SRV":"GDS", status:i%4===3?"inactive":"active", notes:i%2?"Billed monthly":"Ships in 2 days" }));
}
function genResources(): Omit<ResourceRow, "id">[] {
  return Array.from({ length: 5 }, (_, i) => ({ type:"resource", name:`Resource ${i+1}`, code:`RES-${200+i}`, url:`https://example.test/res/${200+i}`, expiresAt:iso(now+(i+1)*7*24*3600_000) }));
}
function genEvents(): Omit<EventRow, "id">[] {
  return Array.from({ length: 5 }, (_, i) => ({ type:"event", name:`Event ${i+1}`, description:`Description for event ${i+1}`, location:i%2?"Main Hall":"Expo Center", startsAt:iso(now+(i+1)*2*3600_000), endsAt:iso(now+(i+1)*4*3600_000), status:i%3===0?"available":i%3===1?"unavailable":"maintenance", capacity:100+i*50 }));
}
function genVendors(): Omit<VendorRow, "id">[] {
  const statuses: VendorRow["status"][] = ["active","inactive","archived"];
  return Array.from({ length: 5 }, (_, i) => ({ type:"vendor", name:`Vendor ${i+1}`, displayName:`V${i+1}`, email:`vendor${i+1}@example.test`, phone:`+1-555-02${(10+i).toString().padStart(2,"0")}`, notes:i%2?"Priority partner":"—", status: statuses[i % statuses.length] }));
}
function genEmployees(): Omit<EmployeeRow, "id">[] {
  return Array.from({ length: 5 }, (_, i) => ({ type:"employee", displayName:`Employee ${i+1}`, email:`employee${i+1}@example.test`, phone:`+1-555-03${(10+i).toString().padStart(2,"0")}`, role:i%2?"Coordinator":"Technician", status:i%3===2?"inactive":"active", hiredAt:iso(now-(i+10)*24*3600_000), startDate:iso(now-(i+10)*24*3600_000), notes:i%2?"Part-time":"—" }));
}
function genInventory(products: ProductRow[]): Omit<InventoryRow, "id">[] {
  // 5 rows: some linked to products, some standalone (no productId)
  return Array.from({ length: 5 }, (_, i) => {
    const maybeProduct = i % 2 === 0 ? products[i % products.length] : undefined;
    return {
      type:"inventory",
      productId: maybeProduct?.id,  // undefined for standalone
      name: maybeProduct?.name ?? (i % 2 ? `Cleaner ${i+1}` : `Supply ${i+1}`),
      sku: maybeProduct?.sku ?? `INV-${300+i}`,
      quantity: 10 + i * 5,
      uom: "ea",
      location: i%2 ? "Supply Closet" : "Warehouse A",
      minQty: 5, maxQty: 100,
      status: i%4===3 ? "inactive" : "active",
      notes: i%2 ? "internal use" : "cycle count",
    };
  });
}
function genRegistrations(events: EventRow[], clients: ClientRow[]): Omit<RegistrationRow, "id">[] {
  const statuses: RegistrationRow["status"][] = ["pending","confirmed","cancelled","checked_in","completed"];
  return Array.from({ length: 5 }, (_, i) => {
    const e = events[i % events.length], c = clients[i % clients.length];
    return { type:"registration", eventId:e.id!, clientId:c.id, startsAt:iso(now+i*3600_000), endsAt:iso(now+(i+2)*3600_000), status: statuses[i % statuses.length], registeredAt:iso(now-i*3600_000), notes:i%2?"Walk-in":"Pre-registered" };
  });
}
function genReservations(resources: ResourceRow[], clients: ClientRow[]): Omit<ReservationRow, "id">[] {
  const statuses: ReservationRow["status"][] = ["pending","confirmed","cancelled","checked_in","completed"];
  return Array.from({ length: 5 }, (_, i) => {
    const r = resources[i % resources.length], c = clients[i % clients.length];
    const s = now + (i+1)*3600_000, e = s + 2*3600_000;
    return { type:"reservation", resourceId:r.id!, start:iso(s), end:iso(e), startsAt:iso(s), endsAt:iso(e), clientId:c.id, status: statuses[i % statuses.length], notes:i%2?"Hold":"Firm" };
  });
}

function getEventId(reg: any): string | undefined {
  if (typeof reg?.eventId === "string") return reg.eventId;
  if (typeof reg?.event_id === "string") return reg.event_id;
  if (typeof reg?.event === "string") return reg.event;
  if (reg?.event?.id) return String(reg.event.id);
  if (reg?.meta?.eventId) return String(reg.meta.eventId);
  if (Array.isArray(reg?.refs)) {
    const r = reg.refs.find((r: any) => r?.type === "event" && (r?.id || r?.refId));
    if (r) return String(r.id ?? r.refId);
  }
}

export default function DevEventsToolsScreen() {
  const [busy, setBusy] = React.useState(false);
  const [log, setLog] = React.useState<string>("");

  const [iType, setIType]   = React.useState<string>("event");
  const [iId, setIId]       = React.useState<string>("");
  const [iLimit, setILimit] = React.useState<string>("10");
  const [iNext, setINext]   = React.useState<string>("");
  const [iQ, setIQ]         = React.useState<string>("");

  const [rawMethod, setRawMethod] = React.useState<"GET"|"POST"|"PUT"|"DELETE">("GET");
  const [rawPath, setRawPath]     = React.useState<string>("/objects/event");
  const [rawBody, setRawBody]     = React.useState<string>("");

  const [summary, setSummary] = React.useState<string>("");
  const [out, setOut] = React.useState<any>(null);

  const append = (s: string) => setLog((p) => `${p}${p ? "\n" : ""}${s}`);

  const wipeAll = React.useCallback(async () => {
    if (busy) return;
    setBusy(true); setLog("");
    try {
      append("Wiping registrations…"); await wipeType("registration");
      append("Wiping reservations…");  await wipeType("reservation");
      append("Wiping inventory…");     await wipeType("inventory");

      append("Wiping events…");        await wipeType("event");
      append("Wiping resources…");     await wipeType("resource");
      append("Wiping products…");      await wipeType("product");
      append("Wiping clients…");       await wipeType("client");
      append("Wiping vendors…");       await wipeType("vendor");
      append("Wiping employees…");     await wipeType("employee");
      append("Wiping accounts…");      await wipeType("account");

      append("Done ✅");
      Alert.alert("Wipe complete", "All modules wiped.");
    } catch (e: any) {
      append(`Error: ${e?.message ?? String(e)}`);
      Alert.alert("Error", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const seedAll = React.useCallback(async () => {
    if (busy) return;
    setBusy(true); setLog("");
    try {
      append("Seeding accounts…");      await postAll<AccountRow>("account", genAccounts());
      append("Seeding clients…"); const clients = await postAll<ClientRow>("client", genClients());
      append("Seeding products…"); const products = await postAll<ProductRow>("product", genProducts());
      append("Seeding resources…"); const resources = await postAll<ResourceRow>("resource", genResources());
      append("Seeding events…");   const events    = await postAll<EventRow>("event", genEvents());
      append("Seeding vendors…");        await postAll<VendorRow>("vendor", genVendors());
      append("Seeding employees…");      await postAll<EmployeeRow>("employee", genEmployees());
      append("Seeding inventory…");      await postAll<InventoryRow>("inventory", genInventory(products));
      append("Seeding registrations…");  await postAll<RegistrationRow>("registration", genRegistrations(events, clients));
      append("Seeding reservations…");   await postAll<ReservationRow>("reservation", genReservations(resources, clients));

      append("Done ✅");
      Alert.alert("Seed complete", "5 records added for every module.");
    } catch (e: any) {
      append(`Error: ${e?.message ?? String(e)}`);
      Alert.alert("Error", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const wipeThenSeed = React.useCallback(async () => {
    await wipeAll();
    setTimeout(() => { seedAll(); }, 300);
  }, [wipeAll, seedAll]);

  const runGet = React.useCallback(async () => {
    try {
      setSummary(`GET /objects/${iType}/${iId}`);
      const res = await apiClient.get(`/objects/${encodeURIComponent(iType)}/${encodeURIComponent(iId)}`);
      setOut(res);
    } catch (e: any) {
      setOut({ error: e?.message ?? String(e) });
    }
  }, [iType, iId]);

  const runList = React.useCallback(async () => {
    try {
      const limitNum = Math.max(1, Math.min(200, Number(iLimit || "10")));
      setSummary(`LIST /objects/${iType}?limit=${limitNum}${iNext ? `&next=${iNext}` : ""}${iQ ? `&q=${iQ}` : ""}`);
      const res: ListPage<any> = await listObjects<any>(iType, { limit: limitNum, next: iNext || undefined, q: iQ || undefined, by: "updatedAt", sort: "desc" });
      setOut(res);
    } catch (e: any) {
      setOut({ error: e?.message ?? String(e) });
    }
  }, [iType, iLimit, iNext, iQ]);

  const runRegCount = React.useCallback(async () => {
    try {
      const eventId = iId.trim();
      if (!eventId) { setOut({ error: "Enter event id in the ID box above." }); return; }
      setSummary(`COUNT registrations for eventId=${eventId}`);
      let total = 0, scanned = 0, next: string | undefined = undefined;
      for (let i = 0; i < 50; i++) {
        const page: ListPage<any> = await listObjects<any>("registration", { limit: 200, next, by: "updatedAt", sort: "desc" });
        const items: any[] = Array.isArray(page?.items) ? page.items : [];
        for (const r of items) total += getEventId(r) === eventId ? 1 : 0;
        scanned += items.length;
        next = (page as any)?.next ?? undefined;
        if (!next) break;
      }
      setOut({ eventId, total, scanned });
    } catch (e: any) {
      setOut({ error: e?.message ?? String(e) });
    }
  }, [iId]);

  const runRaw = React.useCallback(async () => {
    try {
      const path = rawPath.trim() || "/";
      setSummary(`${rawMethod} ${path}`);

      let body: any = undefined;
      if (rawMethod === "POST" || rawMethod === "PUT") {
        if (rawBody.trim().length) {
          body = JSON.parse(rawBody);
        } else body = {};
      }

      let res: any;
      if (rawMethod === "GET")    res = await apiClient.get(path);
      if (rawMethod === "DELETE") res = await apiClient.del(path);
      if (rawMethod === "POST")   res = await apiClient.post(path, body);
      if (rawMethod === "PUT")    res = await apiClient.put(path, body);

      setOut(res ?? { ok: true, empty: true });
    } catch (e: any) {
      setOut({ error: e?.message ?? String(e) });
    }
  }, [rawMethod, rawPath, rawBody]);

  const copyOut = React.useCallback(async () => {
    try {
      const text = j(out ?? {});
      let copied = false;
      try {
        const Clipboard = require("expo-clipboard");
        if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(text); copied = true; }
      } catch {}
      if (!copied) {
        try {
          const RN: any = require("react-native");
          if (RN?.Clipboard?.setString) { RN.Clipboard.setString(text); copied = true; }
          else if (RN?.Clipboard?.setStringAsync) { await RN.Clipboard.setStringAsync(text); copied = true; }
        } catch {}
      }
      Alert.alert("Copied", copied ? "JSON copied to clipboard." : "Rendered JSON ready—long-press to select/copy.");
    } catch {
      Alert.alert("Copy failed", "Could not copy JSON.");
    }
  }, [out]);

  const MethodButton = ({ m }: { m: "GET"|"POST"|"PUT"|"DELETE" }) => (
    <Pressable onPress={() => setRawMethod(m)}
      style={{ backgroundColor: rawMethod === m ? "#16a34a" : "#4b5563", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, marginRight: 8, marginBottom: 8 }}>
      <Text style={{ color: "white", fontWeight: "700" }}>{m}</Text>
    </Pressable>
  );

  const presets = [
    {
      label: "List Events (limit 10)",
      run: async () => {
        setIType("event"); setILimit("10"); setINext(""); setIQ("");
        setSummary(`LIST /objects/event?limit=10`);
        const res: ListPage<EventRow> = await listObjects<EventRow>("event", { limit: 10, by: "updatedAt", sort: "desc" });
        setOut(res);
      },
    },
    {
      label: "Get Event by ID",
      run: async () => {
        setIType("event");
        setSummary(`GET /objects/event/${iId}`);
        const res = await apiClient.get(`/objects/event/${encodeURIComponent(iId.trim())}`);
        setOut(res);
      },
    },
    {
      label: "Registrations: COUNT by Event",
      run: async () => { await runRegCount(); },
    },
    {
      label: "List Vendors (limit 10)",
      run: async () => {
        setIType("vendor"); setILimit("10"); setINext(""); setIQ("");
        setSummary(`LIST /objects/vendor?limit=10`);
        const res: ListPage<VendorRow> = await listObjects<VendorRow>("vendor", { limit: 10, by: "updatedAt", sort: "desc" });
        setOut(res);
      },
    },
    {
      label: "List Clients (limit 10)",
      run: async () => {
        setIType("client"); setILimit("10"); setINext(""); setIQ("");
        setSummary(`LIST /objects/client?limit=10`);
        const res: ListPage<ClientRow> = await listObjects<ClientRow>("client", { limit: 10, by: "updatedAt", sort: "desc" });
        setOut(res);
      },
    },
    {
      label: "List Products (limit 10)",
      run: async () => {
        setIType("product"); setILimit("10"); setINext(""); setIQ("");
        setSummary(`LIST /objects/product?limit=10`);
        const res: ListPage<ProductRow> = await listObjects<ProductRow>("product", { limit: 10, by: "updatedAt", sort: "desc" });
        setOut(res);
      },
    },
    {
      label: "List Inventory (limit 10)",
      run: async () => {
        setIType("inventory"); setILimit("10"); setINext(""); setIQ("");
        setSummary(`LIST /objects/inventory?limit=10`);
        const res: ListPage<InventoryRow> = await listObjects<InventoryRow>("inventory", { limit: 10, by: "updatedAt", sort: "desc" });
        setOut(res);
      },
    },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#0b1220", padding: 16 }}>
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
        Dev Tools — Delete & Populate + API Inspector + Raw HTTP
      </Text>

      <Pressable disabled={busy} onPress={wipeAll}
        style={{ backgroundColor: "#ef4444", opacity: busy ? 0.6 : 1, padding: 14, borderRadius: 10, marginBottom: 10 }}>
        <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>Delete ALL Records</Text>
      </Pressable>

      <Pressable disabled={busy} onPress={seedAll}
        style={{ backgroundColor: "#10b981", opacity: busy ? 0.6 : 1, padding: 14, borderRadius: 10, marginBottom: 10 }}>
        <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>Populate (5 per module)</Text>
      </Pressable>

      <Pressable disabled={busy} onPress={wipeThenSeed}
        style={{ backgroundColor: "#2563eb", opacity: busy ? 0.6 : 1, padding: 14, borderRadius: 10, marginBottom: 16 }}>
        <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>Delete & Populate</Text>
      </Pressable>

      <View style={{ backgroundColor: "#0f172a", borderRadius: 12, borderWidth: 1, borderColor: "#1f2937", padding: 12, marginBottom: 16 }}>
        <Text style={{ color: "#fff", fontWeight: "700", marginBottom: 8 }}>Presets</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {presets.map((p, idx) => (
            <Pressable key={idx} onPress={p.run}
              style={{ backgroundColor: "#4b5563", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, marginRight: 8, marginBottom: 8 }}>
              <Text style={{ color: "white", fontWeight: "700" }}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ backgroundColor: "#0f172a", borderRadius: 12, borderWidth: 1, borderColor: "#1f2937", padding: 12, marginBottom: 16 }}>
        <Text style={{ color: "#fff", fontWeight: "700", marginBottom: 8 }}>API Inspector</Text>

        <Label>Type (e.g., event, registration, client, product, inventory…)</Label>
        <Box value={iType} onChangeText={setIType} autoCapitalize="none" autoCorrect={false} placeholder="event" />

        <Label>ID (for GET, or as eventId for Reg Count)</Label>
        <Box value={iId} onChangeText={setIId} autoCapitalize="none" autoCorrect={false} placeholder="paste an id…" />

        <Label>List options</Label>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Box value={iLimit} onChangeText={setILimit} keyboardType="number-pad" placeholder="limit" style={{ flex: 1 }} />
          <Box value={iNext} onChangeText={setINext} autoCapitalize="none" autoCorrect={false} placeholder="next token" style={{ flex: 1 }} />
        </View>
        <Box value={iQ} onChangeText={setIQ} autoCapitalize="none" autoCorrect={false} placeholder='q (e.g., "name:Event")' />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          <Pressable onPress={runGet}  style={{ backgroundColor: "#4b5563", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
            <Text style={{ color: "white", fontWeight: "700" }}>GET by ID</Text>
          </Pressable>
          <Pressable onPress={runList} style={{ backgroundColor: "#4b5563", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
            <Text style={{ color: "white", fontWeight: "700" }}>LIST</Text>
          </Pressable>
          {iType.trim().toLowerCase() !== "registration" && (
            <Pressable onPress={runRegCount} style={{ backgroundColor: "#4b5563", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
              <Text style={{ color: "white", fontWeight: "700" }}>REG Count (uses ID as eventId)</Text>
            </Pressable>
          )}
        </View>
      </View>

      {!!summary && <Text style={{ color: "#9ca3af", marginBottom: 6 }}>{summary}</Text>}
      <View style={{ borderWidth: 1, borderColor: "#1f2937", backgroundColor: "#0b1220", borderRadius: 8, padding: 8, minHeight: 140 }}>
        <Mono>{j(out ?? {})}</Mono>
      </View>

      <View style={{ marginTop: 12 }}>
        <Text style={{ color: "#9ca3af", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{log || "—"}</Text>
      </View>
    </ScrollView>
  );
}
