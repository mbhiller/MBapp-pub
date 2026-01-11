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
  const [scannerEnabled, setScannerEnabled] = React.useState(true);
  const resolvingRef = React.useRef(false);
  const pendingScanRef = React.useRef<string | null>(null);
  const lastResolvedRef = React.useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const lastScanRef = React.useRef<{ value: string; at: number } | null>(null);
  const lastScanStringRef = React.useRef<string | null>(null);

  const errorMessageMap: Record<string, string> = {
    invalid_scan: "Invalid code. Try scanning again.",
    not_found: "Not found. Verify this is the correct credential.",
    not_in_event: "Wrong event for this scan.",
    registration_not_checkedin: "Check-in required before admitting.",
    ticket_already_used: "Already admitted.",
    ticket_not_valid: "Ticket is not valid.",
  };

  const deriveEventIdFromScan = React.useCallback(
    (scan: string) => {
      if ((scan || "").trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(scan);
          if (typeof parsed?.eventId === "string" && parsed.eventId.trim()) {
            return parsed.eventId.trim();
          }
        } catch {
          // ignore parse errors and fall through to QR parsing
        }
      }
      const ticket = parseTicketQr(scan || "");
      const badge = parseBadgeQr(scan || "");
      return (eventId || ticket?.eventId || badge?.eventId || "").trim();
    },
    [eventId]
  );

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

  const resolveScan = React.useCallback(
    async (incomingScan?: string) => {
      // Guard: prevent concurrent resolves
      if (resolvingRef.current) {
        const scan = (incomingScan ?? scanText ?? "").trim();
        if (scan) {
          pendingScanRef.current = scan;
        }
        return;
      }

      const rawScan = (incomingScan ?? scanText ?? "").trim();
      if (!rawScan) {
        setError("Scan text is required");
        return;
      }

      let scan = rawScan;
      if (rawScan.startsWith("{")) {
        try {
          const parsed = JSON.parse(rawScan);
          if (typeof parsed?.eventId === "string" && parsed.eventId.trim()) {
            if (!eventId || eventId !== parsed.eventId.trim()) {
              setEventId(parsed.eventId.trim());
            }
          }
          if (parsed && parsed.registrationId) {
            scan = JSON.stringify({ ...parsed, eventId: parsed.eventId, registrationId: parsed.registrationId });
          }
        } catch {
          // leave scan as rawScan
        }
      }

      const evId = deriveEventIdFromScan(scan);
      if (!evId) {
        setError("Event ID is required (present in ticket QR or enter manually)");
        return;
      }

      const now = Date.now();
      const last = lastResolvedRef.current;
      if (last.text === scan && now - last.at < 1500) return; // debounce same scan

      resolvingRef.current = true;
      setResolving(true);
      setError(null);
      lastScanStringRef.current = scan;
      setScanText(scan);

      try {
        const res = await resolveRegistrationScan(evId, scan, "auto");
        lastResolvedRef.current = { text: scan, at: Date.now() };
        setResult(res);
        if ((res as any).ok === true) {
          const next = (res as any).nextAction;
          const label = (res as any).nextActionLabel || "Resolved";
          toast(label, (res as any).ready ? "success" : next === "blocked" ? "error" : "info");
        } else {
          const code = (res as any).error;
          const msg = (res as any).reason || errorMessageMap[code] || "Could not resolve scan";
          setError(msg);
        }
      } catch (err: any) {
        const code = err?.code || err?.body?.code;
        const msg = err?.body?.message || err?.message || errorMessageMap[code] || "Failed to resolve scan";
        setError(msg);
      } finally {
        setResolving(false);
        resolvingRef.current = false;
        const pending = pendingScanRef.current;
        pendingScanRef.current = null;
        if (pending && pending !== scan) {
          resolveScan(pending).catch(() => {});
        }
      }
    },
    [deriveEventIdFromScan, errorMessageMap, scanText, toast]
  );

  const handleResolve = React.useCallback(async () => {
    resolveScan().catch(() => {});
  }, [resolveScan]);

  const handleCheckIn = React.useCallback(async () => {
    if (!result || !result.ok) return;
    setCheckingIn(true);
    setError(null);
    try {
      await checkinRegistration(result.registrationId, { "Idempotency-Key": newIdempotencyKey() });
      toast("Checked in", "success");
      // Re-resolve using the last scanned string (preserves ticket context) to show nextAction=admit
      // but do NOT re-enable scanner
      const scanToResolve = lastScanStringRef.current || scanText;
      if (scanToResolve) {
        await resolveScan(scanToResolve);
      }
    } catch (err: any) {
      setError(err?.message || "Check-in failed");
    } finally {
      setCheckingIn(false);
    }
  }, [resolveScan, result, scanText, toast]);

  const handleAdmit = React.useCallback(async () => {
    const ticketId = (result as any)?.ticketId || derivedTicketId;
    if (!result || !result.ok || !ticketId) return;
    setAdmitting(true);
    setError(null);
    try {
      const res = await useTicket(ticketId, newIdempotencyKey());
      setAdmittedTicketId(res?.ticket?.id || ticketId);
      toast("Ticket admitted", "success");
      // Re-resolve using last scanned string to show nextAction=already_admitted + timestamp
      // but do NOT re-enable scanner
      const scanToResolve = lastScanStringRef.current || scanText;
      if (scanToResolve) {
        await resolveScan(scanToResolve);
      }
    } catch (err: any) {
      const code = err?.code || err?.body?.code;
      const reason = err?.body?.message || err?.message || "Admit failed";
      toast(code ? `${code}` : reason, "error");
      setError(reason);
    } finally {
      setAdmitting(false);
    }
  }, [derivedTicketId, resolveScan, result, scanText, toast]);

  const resetAllFields = React.useCallback(() => {
    setScanText("");
    setEventId("");
    setResult(null);
    setError(null);
    setAdmittedTicketId(null);
    setScannerEnabled(true);
    lastScanRef.current = null;
    lastResolvedRef.current = { text: "", at: 0 };
    lastScanStringRef.current = null;
  }, []);

  const clear = React.useCallback(() => {
    resetAllFields();
  }, [resetAllFields]);

  const handleScanNext = React.useCallback(() => {
    resetAllFields();
  }, [resetAllFields]);

  const readyState = result && result.ok ? (result.ready ? "Ready" : "Blocked") : "";
  const ticketIdFromResult = (result as any)?.ticketId || derivedTicketId;
  const nextAction = (result && (result as any).nextAction) || null;
  const blockers = (result && (result as any).blockers) || [];

  const canCheckIn = Boolean(result && result.ok && nextAction === "checkin" && !checkingIn);
  const canAdmit = Boolean(
    ticketIdFromResult &&
    result &&
    result.ok &&
    nextAction === "admit" &&
    !admitting
  );

  const disabledCheckInReason = !result
    ? "Scan a registration"
    : nextAction !== "checkin"
      ? nextAction === "blocked"
        ? "Blocked: resolve blockers"
        : "Resolve to check in"
      : null;

  const disabledAdmitReason = !ticketIdFromResult
    ? "Scan a ticket"
    : !result
      ? "Resolve a scan"
      : nextAction !== "admit"
        ? nextAction === "checkin"
          ? "Check-in required"
          : nextAction === "blocked"
            ? "Blocked: resolve blockers"
            : "Resolve a ticket"
        : null;
  const topBlockers = blockers.slice(0, 2) as Array<{ code: string; action?: string; message?: string }>;
  const ticketUsedAt = (result as any)?.ticketUsedAt as string | null | undefined;

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
        {scannerEnabled && (
          <ScannerPanel
            value={scanText}
            onChange={setScanText}
            onSubmit={handleResolve}
            autoOpenCamera={true}
            onScan={(val) => {
              if (!scannerEnabled) return;
              const normalized = val.trim();
              if (!normalized) return;
              let scanToUse = normalized;
              if (normalized.startsWith("{")) {
                try {
                  const parsed = JSON.parse(normalized);
                  if (typeof parsed?.eventId === "string" && parsed.eventId.trim()) {
                    if (!eventId || eventId !== parsed.eventId.trim()) setEventId(parsed.eventId.trim());
                  }
                  if (parsed && parsed.registrationId) {
                    scanToUse = JSON.stringify({ ...parsed, eventId: parsed.eventId, registrationId: parsed.registrationId });
                  }
                } catch {
                  // keep normalized as-is if parse fails
                }
              }
              // Deduplicate scans within 2s window
              const now = Date.now();
              if (lastScanRef.current && lastScanRef.current.value === scanToUse && now - lastScanRef.current.at < 2000) {
                return; // ignore duplicate
              }
              lastScanRef.current = { value: scanToUse, at: now };
              setScannerEnabled(false); // pause scanner once captured
              lastScanStringRef.current = scanToUse;
              resolveScan(scanToUse).catch(() => {});
            }}
          />
        )}

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
        {!scannerEnabled && result ? (
          <Pressable
            onPress={handleScanNext}
            style={{
              flex: 1,
              backgroundColor: t.colors.primary,
              paddingVertical: 12,
              borderRadius: 8,
              alignItems: "center",
            }}
          >
            <Text style={{ color: t.colors.primaryText, fontWeight: "700" }}>Scan Next</Text>
          </Pressable>
        ) : (
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
        )}
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

      {/* Next Action card */}
      {result && result.ok ? (
        <View style={{ marginBottom: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}>
          <Text style={{ fontWeight: "700", color: t.colors.text, marginBottom: 6 }}>Next Action</Text>
          {result.nextAction === "checkin" ? (
            <View>
              <Text style={{ color: t.colors.text }}>Next: Check In</Text>
              <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>Registration is ready.</Text>
            </View>
          ) : result.nextAction === "admit" ? (
            <View>
              <Text style={{ color: t.colors.text }}>Next: Admit Ticket</Text>
              {ticketIdFromResult ? <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>Ticket: {ticketIdFromResult}</Text> : null}
            </View>
          ) : result.nextAction === "already_admitted" ? (
            <View>
              <Text style={{ color: t.colors.text }}>Already Admitted</Text>
              {ticketUsedAt ? <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>Admitted at {new Date(ticketUsedAt).toLocaleString()}</Text> : null}
            </View>
          ) : result.nextAction === "blocked" ? (
            <View>
              <Text style={{ color: t.colors.text }}>Blocked</Text>
              {topBlockers.length ? (
                <View style={{ marginTop: 4 }}>
                  {topBlockers.map((b: { code: string; action?: string }, idx: number) => (
                    <Text key={`${b.code}-${idx}`} style={{ color: t.colors.textMuted }}>{b.code}{b.action ? ` — ${b.action}` : ""}</Text>
                  ))}
                </View>
              ) : (
                <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>Resolve blockers to proceed.</Text>
              )}
            </View>
          ) : (
            <View>
              <Text style={{ color: t.colors.text }}>Resolved</Text>
              <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>Awaiting next step.</Text>
            </View>
          )}
        </View>
      ) : null}

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
              <Text style={{ color: t.colors.text }}>{(result as any).reason}</Text>
            </View>
          )
        ) : (
          <Text style={{ color: t.colors.textMuted }}>No scan yet.</Text>
        )}
      </View>

      <View style={{ marginTop: 16, gap: 12 }}>
        <View>
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
          {!canCheckIn && disabledCheckInReason ? (
            <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>{disabledCheckInReason}</Text>
          ) : null}
        </View>
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
        {!canAdmit && disabledAdmitReason ? (
          <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>{disabledAdmitReason}</Text>
        ) : null}
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
          {readyState ? `Last resolved: ${readyState}` : "Scan to resolve a registration and check in."}
        </Text>
      </View>
    </ScrollView>
  );
}
