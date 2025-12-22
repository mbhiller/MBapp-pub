// apps/mobile/src/screens/DevToolsScreen.tsx
import React from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useToast } from "../features/_shared/Toast";
import { useQueryClient } from "@tanstack/react-query";
import { listEvents, createEvent } from "../features/events/api";
import { findParties, createParty, addPartyRole } from "../features/parties/api";
import { listResources, createResource } from "../features/resources/api";
import { createProduct } from "../features/products/api";
import { upsertInventoryItem } from "../features/inventory/api";
import { createRegistration } from "../features/registrations/api";
import { createReservation } from "../features/reservations/api";
import { apiClient } from "../api/client";

export default function DevToolsScreen({ navigation }: any) {
  const t = useColors();
  const toast = useToast();
  const qc = useQueryClient();

  // Track last created IDs for quick reference
  const [lastEventId, setLastEventId] = React.useState<string | null>(null);
  const [lastPartyId, setLastPartyId] = React.useState<string | null>(null);
  const [lastVendorId, setLastVendorId] = React.useState<string | null>(null);
  const [lastResourceId, setLastResourceId] = React.useState<string | null>(null);
  const [lastProductId, setLastProductId] = React.useState<string | null>(null);
  const [lastInventoryId, setLastInventoryId] = React.useState<string | null>(null);
  const [lastPurchaseOrderId, setLastPurchaseOrderId] = React.useState<string | null>(null);
  const [lastSalesOrderId, setLastSalesOrderId] = React.useState<string | null>(null);
  const [lastReservationId, setLastReservationId] = React.useState<string | null>(null);
  const [lastRegistrationId, setLastRegistrationId] = React.useState<string | null>(null);

  if (!__DEV__) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: t.colors.bg }}>
        <Text style={{ color: t.colors.text }}>
          Dev Tools are available only in development builds.
        </Text>
      </View>
    );
  }

  const sectionTitle = (title: string) => (
    <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16, marginBottom: 8 }}>{title}</Text>
  );

  const Button = ({ title, onPress, disabled }: { title: string; onPress: () => void | Promise<void>; disabled?: boolean }) => (
    <Pressable
      onPress={onPress}
      disabled={Boolean(disabled)}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: disabled ? "#ccc" : t.colors.primary,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: t.colors.buttonText || "#fff", fontWeight: "700", fontSize: 12 }}>{title}</Text>
    </Pressable>
  );

  /* -------------------- Open list shortcuts -------------------- */
  const openEvents = () => navigation.navigate("EventsList");
  const openParties = () => navigation.navigate("PartyList");
  const openProducts = () => navigation.navigate("ProductsList");
  const openInventory = () => navigation.navigate("InventoryList");
  const openResources = () => navigation.navigate("ResourcesList");
  const openReservations = () => navigation.navigate("ReservationsList");
  const openRegistrations = () => navigation.navigate("RegistrationsList");

  /* -------------------- Seed helpers -------------------- */
  const seedEvent = async () => {
    try {
      const now = new Date();
      const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2h
      const ev = await createEvent({
        name: "Seed Event - Dev",
        status: "scheduled" as any,
        startsAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
        location: "Dev",
      } as any);
      setLastEventId(ev?.id ?? null);
      toast(`✓ Event created: ${ev?.id ?? "(unknown)"}`, "success");
    } catch (e: any) {
      toast(`✗ Event seed failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const seedParty = async () => {
    try {
      const p = await createParty({ kind: "person", name: "Seed Party - Dev" });
      try {
        await addPartyRole(p.id, "customer");
      } catch (e: any) {
        // Role add failure shouldn't block success toast; include note
        toast(`⚠ Party created (${p.id}) — role add failed: ${e?.message ?? String(e)}`, "error");
      }
      setLastPartyId(p?.id ?? null);
      toast(`✓ Party created: ${p?.id ?? "(unknown)"}`, "success");
      qc.invalidateQueries({ queryKey: ["party"] });
    } catch (e: any) {
      toast(`✗ Party seed failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const seedVendor = async () => {
    try {
      const shortId = Math.random().toString(36).slice(2, 8);
      const p = await createParty({ kind: "organization", name: `Seed Vendor - Dev ${shortId}` });
      try {
        await addPartyRole(p.id, "vendor");
      } catch (e: any) {
        toast(`⚠ Vendor party created (${p.id}) — role add failed: ${e?.message ?? String(e)}`, "error");
      }
      setLastVendorId(p?.id ?? null);
      toast(`✓ Vendor created: ${p?.id ?? "(unknown)"}`, "success");
      qc.invalidateQueries({ queryKey: ["party"] });
      return p?.id ?? null;
    } catch (e: any) {
      toast(`✗ Vendor seed failed: ${e?.message ?? String(e)}`, "error");
      return null;
    }
  };

  const seedResource = async () => {
    try {
      const name = `Resource ${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const r = await createResource({ type: "resource" as any, name: name as any, status: "available" as any });
      setLastResourceId((r as any)?.id ?? null);
      toast(`✓ Resource created: ${(r as any)?.id ?? "(unknown)"}`, "success");
      qc.invalidateQueries({ queryKey: ["resources"] });
    } catch (e: any) {
      toast(`✗ Resource seed failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const seedProduct = async () => {
    try {
      const shortId = Math.random().toString(36).slice(2, 8);
      const prod = await createProduct({
        type: "product" as any,
        name: `Seed Product - Dev ${shortId}`,
        sku: `SKU-${shortId}`,
        kind: "good" as any,
        reorderEnabled: true as any,
      });
      setLastProductId((prod as any)?.id ?? null);
      toast(`✓ Product created: ${(prod as any)?.id ?? "(unknown)"}`, "success");
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast(`✗ Product seed failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const seedInventoryItem = async () => {
    try {
      const shortId = Math.random().toString(36).slice(2, 8);

      let productId = lastProductId ?? undefined;
      let productSku: string | undefined;

      if (!productId) {
        const prod = await createProduct({
          type: "product" as any,
          name: `Seed Product - Dev ${shortId}`,
          sku: `SKU-${shortId}`,
          kind: "good" as any,
        });
        productId = (prod as any)?.id;
        productSku = (prod as any)?.sku;
        setLastProductId(productId ?? null);
      }

      const inv = await upsertInventoryItem({
        type: "inventory" as any,
        name: `Seed Inventory - Dev ${shortId}`,
        productId,
        sku: productSku ?? (productId ? undefined : `SKU-${shortId}`),
      });

      setLastInventoryId((inv as any)?.id ?? null);
      toast(`✓ Inventory created: ${(inv as any)?.id ?? "(unknown)"} (product ${productId ?? "unknown"})`, "success");
      qc.invalidateQueries({ queryKey: ["inventory"] });
      return (inv as any)?.id ?? null;
    } catch (e: any) {
      toast(`✗ Inventory seed failed: ${e?.message ?? String(e)}`, "error");
      return null;
    }
  };

  const ensureInventoryId = async (): Promise<string | null> => {
    if (lastInventoryId) return lastInventoryId;
    return await seedInventoryItem();
  };

  const ensureVendorId = async (): Promise<string | null> => {
    if (lastVendorId) return lastVendorId;
    return await seedVendor();
  };

  const seedPurchaseOrderReceive = async () => {
    const shortId = Math.random().toString(36).slice(2, 8);
    const lineQty = 5;
    const lineId = `L${shortId}`;
    const idem = Math.random().toString(36).slice(2, 12);
    try {
      const itemId = await ensureInventoryId();
      if (!itemId) throw new Error("No inventory item available");

      const vendorId = await ensureVendorId();
      if (!vendorId) throw new Error("No vendor available");

      const po = await apiClient.post<any>(
        "/objects/purchaseOrder",
        { type: "purchaseOrder" as any, status: "draft" as any, vendorId, lines: [{ id: lineId, itemId, uom: "ea", qty: lineQty }] }
      );
      const poId = (po as any)?.id;
      if (!poId) throw new Error("PO create failed");
      setLastPurchaseOrderId(poId);

      const createdLineId = (po as any)?.lines?.[0]?.id ?? lineId;

      await apiClient.post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem });
      await apiClient.post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem });
      await apiClient.post(
        `/purchasing/po/${encodeURIComponent(poId)}:receive`,
        { lines: [{ lineId: createdLineId, deltaQty: lineQty }] },
        { "Idempotency-Key": idem }
      );

      toast(`✓ PO received: ${poId}`, "success");
    } catch (e: any) {
      toast(`✗ PO receive failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const checkStockLastInventory = async () => {
    try {
      if (!lastInventoryId) {
        toast("✗ No last inventory ID", "error");
        return;
      }
      const id = lastInventoryId;
      const onhandResp = await apiClient.get<any>(`/inventory/${encodeURIComponent(id)}/onhand`);
      const movementsResp = await apiClient.get<any>(`/inventory/${encodeURIComponent(id)}/movements`);

      const rawOnhand = (onhandResp as any)?.body ?? onhandResp;
      const rawMovements = (movementsResp as any)?.body ?? movementsResp;
      const srcOnhand = Array.isArray(rawOnhand?.items) && rawOnhand.items.length ? rawOnhand.items[0] : rawOnhand;

      const onHand = srcOnhand?.onHand ?? srcOnhand?.onhand ?? 0;
      const reserved = srcOnhand?.reserved ?? 0;
      const available = srcOnhand?.available ?? (typeof onHand === "number" && typeof reserved === "number" ? onHand - reserved : undefined);

      const movementsArr = Array.isArray(rawMovements)
        ? (rawMovements as any)
        : ((rawMovements as any)?.items ?? []);
      const movementsCount = movementsArr?.length ?? 0;
      const lastAction = movementsArr?.[0]?.action ?? movementsArr?.[movementsCount - 1]?.action ?? "—";

      try {
        const rawBlock = [
          "DEVTOOLS STOCK RAW",
          `itemId=${id}`,
          `rawOnhand=${JSON.stringify(rawOnhand)}`,
          `rawMovements=${JSON.stringify(Array.isArray(rawMovements) ? (rawMovements as any).slice(0, 5) : rawMovements)}`,
        ].join("\n");
        // eslint-disable-next-line no-console
        console.log(rawBlock);
      } catch {}

      toast(
        `onHand=${onHand} reserved=${reserved} available=${available ?? "?"} movements=${movementsCount} lastAction=${lastAction}`,
        "success"
      );

      try {
        const rawStr = JSON.stringify(rawOnhand);
        const rawShort = rawStr.length > 250 ? rawStr.slice(0, 250) + "…" : rawStr;
        const first = movementsArr?.[0] ?? null;
        const firstAction = (first as any)?.action ?? (first as any)?.kind ?? "—";
        const firstDelta = (first as any)?.delta ?? (first as any)?.qty ?? (first as any)?.quantity ?? (first as any)?.qtyDelta ?? (first as any)?.quantityDelta ?? "?";
        const firstItemId = (first as any)?.itemId ?? (first as any)?.inventoryId ?? "—";
        toast(`RAW onhand=${rawShort} | firstMovement action=${firstAction} delta=${firstDelta} itemId=${firstItemId}`, "success");
      } catch {}
    } catch (e: any) {
      toast(`✗ Stock check failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const seedReservation = async () => {
    try {
      // Ensure a resource exists: use lastResourceId if available, otherwise create one
      let resourceId: string | undefined = lastResourceId ?? undefined;
      if (!resourceId) {
        const r = await createResource({ type: "resource" as any, name: `Resource ${Date.now()}`, status: "available" as any });
        resourceId = (r as any)?.id;
        setLastResourceId(resourceId ?? null);
      }
      if (!resourceId) throw new Error("No resource available to create reservation");

      const now = new Date();
      const startsAt = new Date(now.getTime() + 15 * 60 * 1000); // +15m
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000); // +1h window
      const resv = await createReservation({
        resourceId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: "pending" as any,
      });
      setLastReservationId(resv?.id ?? null);
      toast(`✓ Resource ${resourceId} + Reservation ${resv?.id ?? "(unknown)"} created`, "success");
    } catch (e: any) {
      toast(`✗ Reservation seed failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const seedRegistration = async () => {
    try {
      // Ensure an event exists
      let eventId: string | undefined;
      try {
        const evPage = await listEvents({ limit: 1 });
        eventId = evPage.items?.[0]?.id;
      } catch {}
      if (!eventId) {
        const now = new Date();
        const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        const ev = await createEvent({
          name: "Seed Event - Dev",
          status: "scheduled" as any,
          startsAt: now.toISOString(),
          endsAt: endsAt.toISOString(),
          location: "Dev",
        } as any);
        eventId = ev?.id;
        setLastEventId(ev?.id ?? null);
      }

      // Ensure a party exists
      let partyId: string | undefined;
      try {
        const parties = await findParties({ q: "", role: undefined as any });
        partyId = parties?.[0]?.id;
      } catch {}
      if (!partyId) {
        const p = await createParty({ kind: "person", name: "Seed Party - Dev" });
        partyId = p?.id;
        setLastPartyId(p?.id ?? null);
        try { await addPartyRole(p.id, "customer"); } catch {}
      }

      if (!eventId || !partyId) throw new Error("Missing event/party prerequisites");

      const reg = await createRegistration({ eventId, partyId, status: "draft" });
      setLastRegistrationId(reg?.id ?? null);
      toast(`✓ Registration created: ${reg?.id ?? "(unknown)"}`, "success");
    } catch (e: any) {
      toast(`✗ Registration seed failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Open Lists */}
      <View style={{ marginBottom: 16 }}>
        {sectionTitle("Open lists")}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button title="Events" onPress={openEvents} />
          <Button title="Parties" onPress={openParties} />
          <Button title="Products" onPress={openProducts} />
          <Button title="Open Inventory" onPress={openInventory} />
          <Button title="Resources" onPress={openResources} />
          <Button title="Reservations" onPress={openReservations} />
          <Button title="Registrations" onPress={openRegistrations} />
        </View>
      </View>

      {/* Seed */}
      <View style={{ marginBottom: 16 }}>
        {sectionTitle("Seed")}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button title="Seed Event" onPress={seedEvent} />
          <Button title="Seed Party" onPress={seedParty} />
          <Button title="Seed Vendor" onPress={async () => { await seedVendor(); }} />
          <Button title="Seed Product" onPress={seedProduct} />
          <Button title="Seed Inventory Item" onPress={async () => { await seedInventoryItem(); }} />
          <Button title="Seed PO + Receive" onPress={async () => { await seedPurchaseOrderReceive(); }} />
          <Button title="Check Stock (last inventory)" onPress={async () => { await checkStockLastInventory(); }} disabled={!lastInventoryId} />
          <Button title="Seed Resource" onPress={seedResource} />
          <Button title="Seed Reservation" onPress={seedReservation} />
          <Button title="Seed Registration" onPress={seedRegistration} />
        </View>
      </View>

      {/* Last created IDs */}
      <View style={{ marginBottom: 8 }}>
        {sectionTitle("Last created IDs")}
        <View style={{ padding: 12, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, backgroundColor: t.colors.card }}>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Event: {lastEventId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Party: {lastPartyId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Vendor: {lastVendorId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Product: {lastProductId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Inventory: {lastInventoryId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Purchase Order: {lastPurchaseOrderId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Sales Order: {lastSalesOrderId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Resource: {lastResourceId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Reservation: {lastReservationId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Registration: {lastRegistrationId ?? "—"}</Text>
        </View>
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
