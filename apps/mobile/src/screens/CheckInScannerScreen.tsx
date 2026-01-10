// apps/mobile/src/screens/CheckInScannerScreen.tsx
import React from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { ScannerPanel } from "../features/_shared/ScannerPanel";
import { useTheme } from "../providers/ThemeProvider";
import { useToast } from "../features/_shared/Toast";
import { parseBadgeQr, parseTicketQr } from "../lib/qr";
import { resolveRegistrationScan, checkinRegistration, useTicket } from "../features/registrations/actions";
import type { components } from "../api/generated-types";

const newIdempotencyKey = () => `mobile-checkin-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function CheckInScannerScreen() {
  const t = useTheme();
  const toast = useToast();

  const [scanText, setScanText] = React.useState("");
  const [eventId, setEventId] = React.useState("");
  const [resolving, setResolving] = React.useState(false);
  const [checkingIn, setCheckingIn] = React.useState(false);
  const [result, setResult] = React.useState<components["schemas"]["ScanResolutionResult"] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [admitting, setAdmitting] = React.useState(false);
  const [admittedTicketId, setAdmittedTicketId] = React.useState<string | null>(null);

  const derivedEventId = React.useMemo(() => {
    const ticket = parseTicketQr(scanText || "");
    const badge = parseBadgeQr(scanText || "");
    return (eventId || ticket?.eventId || badge?.eventId || "").trim();
  }, [eventId, scanText]);

  const derivedTicketId = React.useMemo(() => {
    const ticket = parseTicketQr(scanText || "");
    return ticket?.ticketId || null;
  }, [scanText]);

  const resolvedCheckedInAt = React.useMemo(() => {
    if (!result || !result.ok) return null;
    const snap = (result as any).checkInStatus || {};
    return snap.checkedInAt || (result as any).checkedInAt || null;
  }, [result]);

  const handleResolve = React.useCallback(async () => {
    const trimmedScan = (scanText || "").trim();
    const evId = derivedEventId;
    if (!trimmedScan) {
      setError("Scan text is required");
      return;
    }
    if (!evId) {
      setError("Event ID is required (present in ticket QR or enter manually)");
      return;
    }

    setResolving(true);
    setError(null);
    try {
      const res = await resolveRegistrationScan(evId, trimmedScan, "auto");
      setResult(res);
      if (res.ok) {
        toast("Registration found", res.ready ? "success" : "warning");
      } else {
        setError(res.reason || "Could not resolve scan");
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to resolve scan";
      setError(msg);
    } finally {
      setResolving(false);
    }
  }, [derivedEventId, scanText, toast]);

  const handleCheckIn = React.useCallback(async () => {
    if (!result || !result.ok) return;
    setCheckingIn(true);
    setError(null);
    try {
      await checkinRegistration(result.registrationId, { "Idempotency-Key": newIdempotencyKey() });
      toast("Checked in", "success");
      // Re-resolve to refresh readiness snapshot
      await handleResolve();
    } catch (err: any) {
      setError(err?.message || "Check-in failed");
    } finally {
      setCheckingIn(false);
    }
  }, [handleResolve, result, toast]);

  const handleAdmit = React.useCallback(async () => {
    if (!result || !result.ok || !derivedTicketId) return;
    setAdmitting(true);
    setError(null);
    try {
      const res = await useTicket(derivedTicketId, newIdempotencyKey());
      setAdmittedTicketId(res?.ticket?.id || derivedTicketId);
      toast("Ticket admitted", "success");
      // Refresh resolution to reflect used state/readiness
      await handleResolve();
    } catch (err: any) {
      const code = err?.code || err?.body?.code;
      const reason = err?.body?.message || err?.message || "Admit failed";
      toast(code ? `${code}` : reason, "error");
      setError(reason);
    } finally {
      setAdmitting(false);
    }
  }, [derivedTicketId, handleResolve, result, toast]);

  const clear = React.useCallback(() => {
    setScanText("");
    setResult(null);
    setError(null);
  }, []);

  const readyState = result && result.ok ? (result.ready ? "Ready" : "Blocked") : "";
  const canCheckIn = Boolean(result && result.ok && result.ready && !checkingIn && !resolving);
  const canAdmit = Boolean(
    derivedTicketId &&
    result &&
    result.ok &&
    resolvedCheckedInAt &&
    !admitting &&
    !resolving
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700", color: t.colors.text, marginBottom: 12 }}>Check-In Scanner</Text>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ color: t.colors.textMuted, marginBottom: 6 }}>Use camera to scan or paste QR text manually below. Event ID can be auto-filled from the QR.</Text>

        {/* Manual scanText input for testing/fallback */}
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: t.colors.textMuted, marginBottom: 6 }}>Paste QR Text</Text>
          <TextInput
            value={scanText}
            onChangeText={setScanText}
            placeholder="badge|eventId|... or ticket|eventId|registrationId|..."
            placeholderTextColor={t.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              backgroundColor: t.colors.card,
              color: t.colors.text,
              minHeight: 60,
            }}
          />
        </View>

        {/* Camera scanner */}
        <ScannerPanel value={scanText} onChange={setScanText} onSubmit={handleResolve} />

        {/* Event ID input */}
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: t.colors.textMuted }}>Event ID</Text>
          <TextInput
            value={eventId}
            onChangeText={setEventId}
            placeholder={derivedEventId || "Event ID"}
            placeholderTextColor={t.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              marginTop: 6,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              backgroundColor: t.colors.card,
              color: t.colors.text,
            }}
          />
          {derivedEventId && !eventId ? (
            <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>Auto-filled from QR: {derivedEventId}</Text>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
        <Pressable
          onPress={handleResolve}
          disabled={resolving}
          style={{
            flex: 1,
            backgroundColor: resolving ? t.colors.border : t.colors.primary,
            paddingVertical: 12,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          {resolving ? <ActivityIndicator color={t.colors.primaryText} /> : <Text style={{ color: t.colors.primaryText, fontWeight: "700" }}>Resolve</Text>}
        </Pressable>
        <Pressable
          onPress={clear}
          style={{
            flex: 1,
            backgroundColor: t.colors.card,
            paddingVertical: 12,
            borderRadius: 8,
            alignItems: "center",
            borderWidth: 1,
            borderColor: t.colors.border,
          }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "700" }}>Clear</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={{ marginBottom: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.danger }}>
          <Text style={{ color: t.colors.danger, fontWeight: "700" }}>Error</Text>
          <Text style={{ color: t.colors.text }}>{error}</Text>
        </View>
      ) : null}

      <View style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}>
        <Text style={{ fontWeight: "700", color: t.colors.text, marginBottom: 8 }}>Last scan</Text>
        {result ? (
          result.ok ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: t.colors.text }}>Registration: {result.registrationId}</Text>
              <Text style={{ color: t.colors.text }}>Party: {result.partyId || "(none)"}</Text>
              <Text style={{ color: t.colors.text }}>Status: {result.status}</Text>
              <Text style={{ color: t.colors.text }}>Ready: {result.ready ? "yes" : "no"}</Text>
              {!result.ready && result.blockers?.length ? (
                <View style={{ marginTop: 4 }}>
                  <Text style={{ color: t.colors.text, fontWeight: "600" }}>Blockers</Text>
                  {result.blockers.map((b, idx) => (
                     <Text key={`${b.code}-${idx}`} style={{ color: t.colors.textMuted }}>{b.code}{b.action ? ` — ${b.action}` : ""}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            <View>
              <Text style={{ color: t.colors.text, fontWeight: "600" }}>Resolution failed</Text>
              <Text style={{ color: t.colors.text }}>{result.reason}</Text>
            </View>
          )
        ) : (
          <Text style={{ color: t.colors.textMuted }}>No scan yet.</Text>
        )}
      </View>

      <View style={{ marginTop: 16, gap: 12 }}>
        <Pressable
          onPress={handleCheckIn}
          disabled={!canCheckIn}
          style={{
            backgroundColor: canCheckIn ? t.colors.primary : t.colors.border,
            paddingVertical: 12,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          {checkingIn ? (
            <ActivityIndicator color={t.colors.primaryText} />
          ) : (
            <Text style={{ color: t.colors.primaryText, fontWeight: "700" }}>Check In</Text>
          )}
        </Pressable>
        <Pressable
          onPress={handleAdmit}
          disabled={!canAdmit || Boolean(admittedTicketId && admittedTicketId === derivedTicketId)}
          style={{
            backgroundColor: !canAdmit || Boolean(admittedTicketId && admittedTicketId === derivedTicketId)
              ? t.colors.border
              : t.colors.primary,
            paddingVertical: 12,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          {admitting ? (
            <ActivityIndicator color={t.colors.primaryText} />
          ) : (
            <Text style={{ color: t.colors.primaryText, fontWeight: "700" }}>Admit Ticket</Text>
          )}
        </Pressable>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
          {readyState ? `Last resolved: ${readyState}` : "Scan to resolve a registration and check in."}
        </Text>
      </View>
    </ScrollView>
  );
}
