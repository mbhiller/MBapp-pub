import React from "react";
import { ScrollView, View, Text, Pressable, TextInput, Platform } from "react-native";
import type { components } from "../api/generated-types";
type Schemas = components["schemas"];
import {
  apiClient,
  listObjects,
  createObject,
  updateObject,
  getObject,
  deleteObject as delObject,
  setBearerToken,
} from "../api/client";

/* ---------- UI bits ---------- */
type BtnProps = { label: string; onPress?: () => any | Promise<any> };
const Btn = ({ label, onPress }: BtnProps) => {
  const handlePress = React.useCallback(() => {
    try {
      const p = onPress?.();
      if (p && typeof (p as Promise<any>).then === "function") void (p as Promise<any>).catch(() => {});
    } catch {}
  }, [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      style={{ backgroundColor: "#2563eb", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, marginRight: 8, marginTop: 8 }}
    >
      <Text style={{ color: "white", fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ marginTop: 16, padding: 12, borderWidth: 1, borderColor: "#374151", borderRadius: 10, backgroundColor: "#0b1220" }}>
    <Text style={{ color: "#e5e7eb", fontWeight: "700", marginBottom: 8 }}>{title}</Text>
    {children}
  </View>
);
const Box = (props: any) => (
  <TextInput
    {...props}
    style={[
      { borderWidth: 1, borderColor: "#374151", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: "#e5e7eb", backgroundColor: "#111827", marginBottom: 8 },
      props.style,
    ]}
    placeholderTextColor="#6b7280"
  />
);

/* ---------- helpers ---------- */
function nowTag(prefix: string) {
  const d = new Date();
  return `${prefix}-${d.toISOString().replace(/[-:TZ.]/g, "").slice(4, 12)}`;
}
async function wipeType(type: string, log: (s: string) => void) {
  let next: string | undefined;
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const page = await listObjects<any>(type, { limit: 100, next });
    const items = page.items || [];
    if (!items.length) break;
    for (const it of items) {
      try { await delObject(type, String(it.id)); total++; }
      catch (e: any) { log(`DELETE ${type}/${it.id} failed: ${e?.message || e}`); }
    }
    next = page.next;
    if (!next) break;
  }
  return total;
}
function pretty(obj: any) { try { return JSON.stringify(obj, null, 2); } catch { return String(obj); } }
function normalizeError(e: any) {
  const status = e?.status || e?.statusCode || e?.response?.status;
  const body = e?.body || e?.response?.data || e?.data;
  const message = e?.message ?? "Error";
  return { message, status, body };
}

/* ---------- screen ---------- */
export default function DevEventsToolsScreen() {
  const [log, setLog] = React.useState("");
  const append = (s: string) => setLog((p) => (p ? p + "\n" : "") + s);

  const [resp, setResp] = React.useState<string>("—");
  const show = (x: any) => setResp(pretty(x));

  // dev login
  const [devUser, setDevUser] = React.useState("dev@example.com");
  const [devTenant, setDevTenant] = React.useState("DemoTenant");

  // objects quick actions
  const [rawType, setRawType] = React.useState("purchaseOrder");
  const [rawId, setRawId] = React.useState("");

  // search
  const [searchType, setSearchType] = React.useState("purchaseOrder");
  const [searchField, setSearchField] = React.useState("status");
  const [searchValue, setSearchValue] = React.useState("draft");

  /* ----- server/auth ----- */
  const doHealth = async () => {
    try {
      const res = await apiClient.get<{ ok: boolean; now: string; service: string }>("/health");
      append(`HEALTH ok=${res.ok} now=${res.now}`);
      show(res);
    } catch (e: any) { const n = normalizeError(e); append(`HEALTH error: ${n.message}`); show(n); }
  };
  const doDevLogin = async () => {
    try {
      const data = await apiClient.post<{ token: string }>("/auth/dev-login", { email: devUser, tenantId: devTenant });
      setBearerToken(data.token);
      append("DEV LOGIN ok — bearer set");
      show(data);
    } catch (e: any) { const n = normalizeError(e); append(`DEV LOGIN failed: ${n.message}`); show(n); }
  };
  const doPolicy = async () => {
    try { const p = await apiClient.get<any>("/auth/policy"); append("POLICY loaded"); show(p); }
    catch (e: any) { const n = normalizeError(e); append(`POLICY failed: ${n.message}`); show(n); }
  };

  /* ----- generic objects quick actions ----- */
  const doGet = async () => {
    try { const r = await getObject<any>(rawType.trim(), rawId.trim()); append(`${rawType}/${rawId}: ok`); show(r); }
    catch (e: any) { const n = normalizeError(e); append(`GET ${rawType}/${rawId} failed: ${n.message}`); show(n); }
  };
  const doDelete = async () => {
    try { await delObject(rawType.trim(), rawId.trim()); append(`DELETE ${rawType}/${rawId}: ok`); show({ ok: true }); }
    catch (e: any) { const n = normalizeError(e); append(`DELETE ${rawType}/${rawId} failed: ${n.message}`); show(n); }
  };
  const doWipe = async () => {
    try { const n = await wipeType(rawType.trim(), append); const r = { type: rawType, deleted: n }; append(`WIPE ${rawType}: deleted ${n} item(s).`); show(r); }
    catch (e: any) { const n = normalizeError(e); append(`WIPE ${rawType} failed: ${n.message}`); show(n); }
  };
  const doSearch = async () => {
    try {
      const res = await apiClient.post<{ items: any[]; next?: string }>(`/objects/${encodeURIComponent(searchType)}/search`, {
        [searchField]: searchValue, limit: 50,
      });
      append(`SEARCH ${searchType} ${searchField}=${searchValue}: ok`);
      show(res);
    } catch (e: any) { const n = normalizeError(e); append(`SEARCH failed: ${n.message}`); show(n); }
  };

  /* ----- seed helpers ----- */
  const seedVendor = async () => {
    const vendor = await createObject<any>("vendor", { type: "vendor", name: nowTag("Vendor"), status: "active" });
    append(`CREATED vendor: ${vendor.id}`); show(vendor);
    return vendor;
  };
  const seedCustomer = async () => {
    const cust = await createObject<any>("customer", { type: "customer", name: nowTag("Customer"), status: "active" });
    append(`CREATED customer: ${cust.id}`); show(cust);
    return cust;
  };
  const seedClient = async () => {
    const client = await createObject<any>("client", { type: "client", name: nowTag("Client"), status: "active" });
    append(`CREATED client: ${client.id}`); show(client);
    return client;
  };
  const seedAccount = async () => {
    const acc = await createObject<any>("account", { type: "account", name: nowTag("Account"), status: "active" });
    append(`CREATED account: ${acc.id}`); show(acc);
    return acc;
  };
  const seedProduct = async () => {
    const product = await createObject<any>("product", {
      type: "product",
      name: nowTag("Product"),
      sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      kind: "good",
      status: "active",
    });
    append(`CREATED product: ${product.id}`); show(product);
    return product;
  };
  const seedInventory = async (productId?: string) => {
    const inv = await createObject<any>("inventory", { type: "inventory", productId, uom: "each", status: "active" });
    append(`CREATED inventory: ${inv.id}`); show(inv);
    return inv;
  };

  // ---------- PO helpers ----------
  const seedPOHeader = async (vendor?: any) => {
    const po = await createObject<any>("purchaseOrder", {
      type: "purchaseOrder",
      status: "draft",
      vendorId: vendor?.id,
      vendorName: vendor?.name ?? "Sample Vendor",
      orderNumber: nowTag("PO"),
      notes: "Seeded from mobile Dev Tools",
    });
    append(`CREATED purchaseOrder: ${po.id}`); show(po);
    return po;
  };
  const seedPOLine = async (poId: string, itemId: string) => {
    const updated = await updateObject<any>("purchaseOrder", poId, {
      lines: [{ itemId, qty: 5, uom: "each", qtyReceived: 0 }],
    });
    append(`UPDATED purchaseOrder (add line): ${updated.id}`); show(updated);
    return updated;
  };
  const poSubmit = async (id: string) => apiClient.post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {});
  const poApprove = async (id: string) => apiClient.post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {});
  const poReceiveAll = async (id: string) => {
    const po = await getObject<any>("purchaseOrder", id);
    const lines = (po.lines || []).map((l: any) => {
      const rem = Math.max(0, Number(l.qty ?? 0) - Number(l.qtyReceived ?? 0));
      return rem > 0 ? { lineId: String(l.id), deltaQty: rem } : null;
    }).filter(Boolean) as any[];
    if (!lines.length) return { ok: true, note: "Nothing to receive" };
    return apiClient.post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines });
  };

  // ---------- SO helpers ----------
  const seedSOHeader = async (customer?: any) => {
    const so = await createObject<any>("salesOrder", {
      type: "salesOrder",
      status: "draft",
      customerId: customer?.id,
      customerName: customer?.name ?? "Sample Customer",
      orderNumber: nowTag("SO"),
      notes: "Seeded from mobile Dev Tools",
    });
    append(`CREATED salesOrder: ${so.id}`); show(so);
    return so;
  };
  const seedSOLine = async (soId: string, itemId: string) => {
    const updated = await updateObject<any>("salesOrder", soId, {
      lines: [{ itemId, qty: 2, uom: "each", qtyFulfilled: 0 }],
    });
    append(`UPDATED salesOrder (add line): ${updated.id}`); show(updated);
    return updated;
  };
  const soSubmit = async (id: string) => apiClient.post(`/sales/so/${encodeURIComponent(id)}:submit`, {});
  const soCommit = async (id: string) => apiClient.post(`/sales/so/${encodeURIComponent(id)}:commit`, {});
  const soFulfillAll = async (id: string) => {
    const so = await getObject<any>("salesOrder", id);
    const lines = (so.lines || []).map((l: any) => {
      const rem = Math.max(0, Number(l.qty ?? 0) - Number(l.qtyFulfilled ?? 0));
      return rem > 0 ? { lineId: String(l.id), deltaQty: rem } : null;
    }).filter(Boolean) as any[];
    if (!lines.length) return { ok: true, note: "Nothing to fulfill" };
    return apiClient.post(`/sales/so/${encodeURIComponent(id)}:fulfill`, { lines });
  };

  // ---------- Events/Resources ----------
  const seedEvent = async () => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const endsAt   = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
    const e = await apiClient.post<Schemas["Event"]>("/objects/event", {
      type: "event",
      name: "Demo Event",
      startsAt,
      endsAt,
      status: "available",
      capacity: 100,
      location: "Main Arena",
    });
    append(`CREATED event: ${e.id}`); show(e);
    return e;
  };
  const seedResource = async () => {
    const r = await apiClient.post<Schemas["Resource"]>("/objects/resource", {
      type: "resource",
      name: "Stall A-01",
      kind: "stall",
      status: "active",
    });
    append(`CREATED resource: ${r.id}`); show(r);
    return r;
  };
  const seedRegistration = async (eventId: string) => {
    const reg = await apiClient.post<Schemas["Registration"]>("/objects/registration", {
      type: "registration",
      eventId,
      clientName: "Demo Rider",
      qty: 1,
      status: "confirmed",
    });
    append(`CREATED registration: ${reg.id}`); show(reg);
    return reg;
  };
  const seedReservation = async (resourceId: string) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const endsAt   = new Date(now.getTime() + 2 * 60 * 1000 * 60).toISOString();
    const resv = await apiClient.post<Schemas["Reservation"]>("/objects/reservation", {
      type: "reservation",
      resourceId,
      startsAt,
      endsAt,
      status: "confirmed",
      clientName: "Demo Client",
    });
    append(`CREATED reservation: ${resv.id}`); show(resv);
    return resv;
  };

  // ---------- composed flows ----------
  const seedPurchaseFlow = async () => {
    const vendor = await seedVendor();
    const product = await seedProduct();
    const inv = await seedInventory(product?.id);
    const po = await seedPOHeader(vendor);
    await seedPOLine(String(po.id), String(inv.id));
    append("SEED purchase flow: vendor+product+inventory+PO line — ok");
    return { vendor, product, inv, poId: po.id };
  };
  const seedSalesFlow = async () => {
    const customer = await seedCustomer();
    const product = await seedProduct();
    const inv = await seedInventory(product?.id);
    const so = await seedSOHeader(customer);
    await seedSOLine(String(so.id), String(inv.id));
    append("SEED sales flow: customer+product+inventory+SO line — ok");
    return { customer, product, inv, soId: so.id };
  };
  const seedAllCore = async () => {
    const vendor = await seedVendor();
    const customer = await seedCustomer();
    const client = await seedClient();
    const account = await seedAccount();
    const product = await seedProduct();
    const inv = await seedInventory(product?.id);
    const po = await seedPOHeader(vendor);
    await seedPOLine(String(po.id), String(inv.id));
    const so = await seedSOHeader(customer);
    await seedSOLine(String(so.id), String(inv.id));
    append("SEED ALL (core): vendor + customer + client + account + product + inventory + PO(line) + SO(line) — ok");
    return { vendor, customer, client, account, product, inv, poId: po.id, soId: so.id };
  };
  const seedEverything = async () => {
    const core = await seedAllCore();
    const event = await seedEvent();
    const resource = await seedResource();
    const reg = await seedRegistration(String(event.id));
    const resv = await seedReservation(String(resource.id));
    const result = { ...core, eventId: event.id, resourceId: resource.id, registrationId: reg.id, reservationId: resv.id };
    append("SEED EVERYTHING — done");
    show(result);
    return result;
  };

  // ---------- Inventory checks ----------
  const checkLastInventory = async () => {
    const page = await listObjects<any>("inventory", { limit: 1, sort: "desc" as any });
    const it = page.items?.[0];
    if (!it) { append("No inventory item found"); show({ error: "No inventory item found" }); return; }
    const onhand = await apiClient.get(`/inventory/${encodeURIComponent(String(it.id))}/onhand`);
    const moves  = await apiClient.get(`/inventory/${encodeURIComponent(String(it.id))}/movements`);
    append(`INVENTORY ${it.id} onhand + movements`); show({ onhand, movements: moves });
  };

  // ---------- 409 smokes ----------
  const doCapacity409 = async () => {
    try {
      const now = new Date();
      const startsAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const endsAt   = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
      const e = await apiClient.post<Schemas["Event"]>("/objects/event", {
        type: "event", name: nowTag("CapEvent"), startsAt, endsAt, status: "available", capacity: 1,
      });
      const r1 = await apiClient.post<Schemas["Registration"]>("/objects/registration", {
        type: "registration", eventId: String(e.id), clientName: "Rider One", qty: 1, status: "confirmed",
      });
      const r2 = await apiClient.post<Schemas["Registration"]>("/objects/registration", {
        type: "registration", eventId: String(e.id), clientName: "Rider Two", qty: 1, status: "confirmed",
      });
      await apiClient.post(`/events/registration/${encodeURIComponent(String(r1.id))}:checkin`, {});
      try {
        const bad = await apiClient.post(`/events/registration/${encodeURIComponent(String(r2.id))}:checkin`, {});
        append("Expected 409 but received 200"); show(bad);
      } catch (e: any) {
        const n = normalizeError(e);
        append(`CAPACITY 409: ${n.status ?? "error"} — ${n.message}`); show(n);
      }
    } catch (e: any) {
      const n = normalizeError(e); append(`Capacity test failed: ${n.message}`); show(n);
    }
  };

  const doOverlap409 = async () => {
    try {
      const r = await seedResource();
      const now = new Date();
      const s1 = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const e1 = new Date(now.getTime() + 90 * 60 * 1000).toISOString();
      const s2 = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      const e2 = new Date(now.getTime() + 120 * 60 * 1000).toISOString();
      const a = await apiClient.post<Schemas["Reservation"]>("/objects/reservation", {
        type: "reservation", resourceId: String(r.id), startsAt: s1, endsAt: e1, status: "confirmed", clientName: "Overlap A",
      });
      const b = await apiClient.post<Schemas["Reservation"]>("/objects/reservation", {
        type: "reservation", resourceId: String(r.id), startsAt: s2, endsAt: e2, status: "confirmed", clientName: "Overlap B",
      });
      await apiClient.post(`/resources/reservation/${encodeURIComponent(String(a.id))}:start`, {});
      try {
        const bad = await apiClient.post(`/resources/reservation/${encodeURIComponent(String(b.id))}:start`, {});
        append("Expected 409 but received 200"); show(bad);
      } catch (e: any) {
        const n = normalizeError(e);
        append(`OVERLAP 409: ${n.status ?? "error"} — ${n.message}`); show(n);
      }
    } catch (e: any) {
      const n = normalizeError(e); append(`Overlap test failed: ${n.message}`); show(n);
    }
  };

  // ---------- Admin GC ----------
 // Replace your current gcList/gcDelete with these:

// ---------- Admin GC ----------
// ---------- Admin GC ----------
const gcList = async (type: string) => {
  try {
    const res = await apiClient.get<{ type?: string; count?: number; items?: any[] }>(`/tools/gc/${encodeURIComponent(type)}`);
    const count = (res as any)?.count ?? (res as any)?.Count ?? ((res as any)?.items?.length ?? 0);
    append(`GC LIST ${type}: ${count}`);
    show(res);
  } catch (e: any) {
    const n = normalizeError(e);
    append(`GC LIST ${type} failed: ${n.message}`);
    show(n);
  }
};

const gcDelete = async (type: string) => {
  try {
    const res = await apiClient.del<{ type?: string; deleted?: number; matched?: number; scanned?: number }>(`/tools/gc/${encodeURIComponent(type)}`);
    const deleted = (res as any)?.deleted ?? 0;
    append(`GC DELETE ${type}: deleted=${deleted}`);
    show(res);
  } catch (e: any) {
    const n = normalizeError(e);
    append(`GC DELETE ${type} failed: ${n.message}`);
    show(n);
  }
};
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#0b1220", padding: 12 }}>
      <Text style={{ color: "#9ca3af", marginBottom: 8 }}>
        Dev Tools — seed & smokes across modules + admin GC.
      </Text>

      {/* Server & Auth */}
      <Section title="Server & Auth">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Health" onPress={doHealth} />
          <Btn label="Dev Login" onPress={doDevLogin} />
          <Btn label="Auth Policy" onPress={doPolicy} />
        </View>
        <Text style={{ color: "#9ca3af", marginTop: 8 }}>Dev login payload</Text>
        <Box value={devUser} onChangeText={setDevUser} placeholder="email" autoCapitalize="none" />
        <Box value={devTenant} onChangeText={setDevTenant} placeholder="tenantId" autoCapitalize="none" />
      </Section>

      {/* One-click seed / delete */}
      <Section title="One-click — Seed / Delete">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Seed EVERYTHING" onPress={seedEverything} />
          <Btn label="DELETE EVERYTHING" onPress={async () => {
            const types = [
              "salesOrder", "purchaseOrder",
              "registration", "reservation",
              "resource", "event",
              "inventory", "product",
              "vendor", "customer", "client", "account",
              "employee",
            ];
            let total = 0;
            for (const t of types) total += await wipeType(t, append);
            append(`WIPE EVERYTHING: deleted total ${total} item(s).`);
            show({ ok: true, deleted: total });
          }} />
        </View>
        <Text style={{ color: "#f59e0b", marginTop: 6, fontSize: 12 }}>
          Tip: run “Dev Login” first for wildcard perms.
        </Text>
      </Section>

      {/* Core seeds */}
      <Section title="Seeds — core records">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Vendor" onPress={seedVendor} />
          <Btn label="Customer" onPress={seedCustomer} />
          <Btn label="Client" onPress={seedClient} />
          <Btn label="Account" onPress={seedAccount} />
          <Btn label="Product" onPress={seedProduct} />
          <Btn label="Inventory" onPress={() => seedInventory(undefined)} />
        </View>
      </Section>

      {/* Purchasing */}
      <Section title="Purchasing — seed & actions">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Seed Purchase Flow" onPress={seedPurchaseFlow} />
          <Btn label="PO Submit last" onPress={async () => {
            const page = await listObjects<any>("purchaseOrder", { limit: 1, sort: "desc" as any });
            const po = page.items?.[0]; if (!po) return append("No PO found");
            const res = await poSubmit(String(po.id)); append(`PO submit: ${po.id}`); show(res);
          }} />
          <Btn label="PO Approve last" onPress={async () => {
            const page = await listObjects<any>("purchaseOrder", { limit: 1, sort: "desc" as any });
            const po = page.items?.[0]; if (!po) return append("No PO found");
            const res = await poApprove(String(po.id)); append(`PO approve: ${po.id}`); show(res);
          }} />
          <Btn label="PO Receive all (last)" onPress={async () => {
            const page = await listObjects<any>("purchaseOrder", { limit: 1, sort: "desc" as any });
            const po = page.items?.[0]; if (!po) { append("No PO to receive."); show({ error: "No PO to receive" }); return; }
            const res = await poReceiveAll(String(po.id)); append(`PO receive all: ${po.id}`); show(res);
          }} />
        </View>
      </Section>

      {/* Sales */}
      <Section title="Sales — seed & actions">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Seed Sales Flow" onPress={seedSalesFlow} />
          <Btn label="SO Submit last" onPress={async () => {
            const page = await listObjects<any>("salesOrder", { limit: 1, sort: "desc" as any });
            const so = page.items?.[0]; if (!so) return append("No SO found");
            const res = await soSubmit(String(so.id)); append(`SO submit: ${so.id}`); show(res);
          }} />
          <Btn label="SO Commit last" onPress={async () => {
            const page = await listObjects<any>("salesOrder", { limit: 1, sort: "desc" as any });
            const so = page.items?.[0]; if (!so) return append("No SO found");
            const res = await soCommit(String(so.id)); append(`SO commit: ${so.id}`); show(res);
          }} />
          <Btn label="SO Fulfill all (last)" onPress={async () => {
            const page = await listObjects<any>("salesOrder", { limit: 1, sort: "desc" as any });
            const so = page.items?.[0]; if (!so) { append("No SO to fulfill."); show({ error: "No SO to fulfill" }); return; }
            const res = await soFulfillAll(String(so.id)); append(`SO fulfill all: ${so.id}`); show(res);
          }} />
        </View>
      </Section>

      {/* Inventory checks */}
      <Section title="Inventory — quick checks">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Check last item (onhand+moves)" onPress={checkLastInventory} />
        </View>
      </Section>

      {/* Events & reservations */}
      <Section title="Events & Reservations — seeds">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Seed Event" onPress={seedEvent} />
          <Btn label="Seed Resource" onPress={seedResource} />
          <Btn label="Seed Registration" onPress={async () => {
            const evs = await listObjects<Schemas["Event"]>("event", { limit: 1, sort: "desc" as any });
            const e = evs.items?.[0]; if (!e) { append("No event found"); show({ error: "No event found" }); return; }
            const reg = await seedRegistration(String(e.id)); show(reg);
          }} />
          <Btn label="Seed Reservation" onPress={async () => {
            const rs = await listObjects<Schemas["Resource"]>("resource", { limit: 1, sort: "desc" as any });
            const r = rs.items?.[0]; if (!r) { append("No resource found"); show({ error: "No resource found" }); return; }
            const resv = await seedReservation(String(r.id)); show(resv);
          }} />
        </View>
      </Section>

      {/* 409 smokes */}
      <Section title="Smokes — 409 validations">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Capacity 409 (Registration)" onPress={doCapacity409} />
          <Btn label="Overlap 409 (Reservation)" onPress={doOverlap409} />
        </View>
      </Section>

      {/* Admin GC */}
      <Section title="Admin — GC (by type)">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="GC List products" onPress={() => gcList("product")} />
          <Btn label="GC Delete products" onPress={() => gcDelete("product")} />
          <Btn label="GC List inventory" onPress={() => gcList("inventory")} />
          <Btn label="GC Delete inventory" onPress={() => gcDelete("inventory")} />
        </View>
        <Text style={{ color: "#6b7280", marginTop: 6, fontSize: 12 }}>
          Requires server route /tools/gc/:type with admin:reset perm.
        </Text>
      </Section>

      {/* Admin — GC by exact keys */}
<Section title="Admin — GC (delete by exact keys)">
  <Text style={{ color: "#9ca3af", marginBottom: 6, fontSize: 12 }}>
    Paste one pk|sk per line (e.g.|product|abc | abc). Use “List ALL (raw)” to discover keys.
  </Text>
  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
    <Btn label="List ALL (raw)" onPress={async () => {
      try {
        const res = await apiClient.get<{ scanned: number; count: number; items: any[] }>(
          `/tools/gc/list-all?limit=2000`
        );
        append(`GC LIST ALL: scanned=${res.scanned}, count=${res.count}`);
        show(res);
      } catch (e: any) { const n = normalizeError(e); append(`GC LIST ALL failed: ${n.message}`); show(n); }
    }} />
    <Btn label="List ALL containing 'product'" onPress={async () => {
      try {
        const res = await apiClient.get<{ scanned: number; count: number; items: any[] }>(
          `/tools/gc/list-all?limit=2000&contains=product`
        );
        append(`GC LIST ALL (contains=product): scanned=${res.scanned}, count=${res.count}`);
        show(res);
      } catch (e: any) { const n = normalizeError(e); append(`GC LIST ALL (product) failed: ${n.message}`); show(n); }
    }} />
  </View>

  {/* paste pk|sk lines here */}
  <Box
    value={resp} // reuse the response box temporarily to paste keys if you want; or add a new state if you prefer
    onChangeText={setResp}
    multiline
    style={{ minHeight: 120, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
    placeholder="pk|sk\npk|sk"
  />
  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
    <Btn label="Delete pasted keys" onPress={async () => {
      try {
        const lines = (resp || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const keys = lines.map((ln) => {
          const [pk, sk] = ln.split("|").map((s) => s.trim());
          return { pk, sk };
        }).filter(k => k.pk && k.sk);
        const res = await apiClient.post<{ requested: number; deleted: number; errors: any[] }>(
          "/tools/gc/delete-keys",
          { keys }
        );
        append(`GC DELETE-KEYS: requested=${res.requested}, deleted=${res.deleted}, errors=${res.errors?.length || 0}`);
        show(res);
      } catch (e: any) { const n = normalizeError(e); append(`GC DELETE-KEYS failed: ${n.message}`); show(n); }
    }} />
  </View>
</Section>


      {/* Response & Log */}
      <Section title="Response (latest)">
        <Box value={resp} onChangeText={() => {}} editable={false} multiline style={{ minHeight: 160, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="Clear Response" onPress={() => setResp("—")} />
          <Btn label="Clear Log" onPress={() => setLog("")} />
        </View>
      </Section>

      <View style={{ marginTop: 12 }}>
        <Text style={{ color: "#9ca3af", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 }}>
          {log || "—"}
        </Text>
      </View>
    </ScrollView>
  );
}
