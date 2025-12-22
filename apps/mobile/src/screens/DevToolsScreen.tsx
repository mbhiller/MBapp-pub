// apps/mobile/src/screens/DevToolsScreen.tsx
import React from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useToast } from "../features/_shared/Toast";
import { listEvents, createEvent } from "../features/events/api";
import { findParties, createParty, addPartyRole } from "../features/parties/api";
import { listResources, createResource } from "../features/resources/api";
import { createRegistration } from "../features/registrations/api";
import { createReservation } from "../features/reservations/api";

export default function DevToolsScreen({ navigation }: any) {
  const t = useColors();
  const toast = useToast();

  // Track last created IDs for quick reference
  const [lastEventId, setLastEventId] = React.useState<string | null>(null);
  const [lastPartyId, setLastPartyId] = React.useState<string | null>(null);
  const [lastVendorId, setLastVendorId] = React.useState<string | null>(null);
  const [lastResourceId, setLastResourceId] = React.useState<string | null>(null);
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
        toast(`⚠ Party created (${p.id}) — role add failed: ${e?.message ?? String(e)}`);
      }
      setLastPartyId(p?.id ?? null);
      toast(`✓ Party created: ${p?.id ?? "(unknown)"}`, "success");
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
        toast(`⚠ Vendor party created (${p.id}) — role add failed: ${e?.message ?? String(e)}`);
      }
      setLastVendorId(p?.id ?? null);
      toast(`✓ Vendor created: ${p?.id ?? "(unknown)"}`, "success");
    } catch (e: any) {
      toast(`✗ Vendor seed failed: ${e?.message ?? String(e)}`, "error");
    }
  };

  const seedResource = async () => {
    try {
      const name = `Resource ${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const r = await createResource({ type: "resource" as any, name: name as any, status: "available" as any });
      setLastResourceId((r as any)?.id ?? null);
      toast(`✓ Resource created: ${(r as any)?.id ?? "(unknown)"}`, "success");
    } catch (e: any) {
      toast(`✗ Resource seed failed: ${e?.message ?? String(e)}`, "error");
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
          <Button title="Seed Vendor" onPress={seedVendor} />
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
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Resource: {lastResourceId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Reservation: {lastReservationId ?? "—"}</Text>
          <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Registration: {lastRegistrationId ?? "—"}</Text>
        </View>
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
