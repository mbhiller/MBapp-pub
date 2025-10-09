// apps/mobile/src/screens/SalesOrderDetailScreen.tsx
import * as React from "react";
import {
  View, Text, TextInput, Pressable, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { getObject, updateObject, createObject } from "../api/client";
import { ScannerPanel } from "../features/_shared/ScannerPanel";

// If your client exports `api`, we'll use it; otherwise we'll fall back to fetch below.
let api: undefined | ((path: string, init?: any) => Promise<any>);
try {
  // @ts-ignore – optional import if it exists in your project
  ({ api } = require("../api/client"));
} catch {}

type RootStackParamList = {
  SalesOrderDetail:
    | { id?: string; mode?: "new" | "edit"; expandScanner?: boolean }
    | undefined;
};
type Route = RouteProp<RootStackParamList, "SalesOrderDetail">;

const STATUS_VALUES = [
  "draft",
  "submitted",
  "committed",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
  "closed",
] as const;

export default function SalesOrderDetailScreen() {
  const { params } = useRoute<Route>();
  const t = useColors();

  const [id, setId] = React.useState<string | undefined>(params?.id);
  const [customerName, setCustomerName] = React.useState("");
  const [status, setStatus] = React.useState("draft");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<any[]>([]);
  const [meta, setMeta] = React.useState<any>({});
  const [loading, setLoading] = React.useState(Boolean(id));
  const [saving, setSaving] = React.useState(false);
  const [acting, setActing] = React.useState(false);

  // --- Helpers ---------------------------------------------------------------

  async function load(soId?: string) {
    const theId = soId ?? id;
    if (!theId) return;
    try {
      setLoading(true);
      const so = await getObject<any>("salesOrder", theId);
      setCustomerName(String(so?.customerName ?? ""));
      setStatus(String(so?.status ?? "draft"));
      setNotes(String(so?.notes ?? ""));
      setLines(Array.isArray(so?.lines) ? so.lines : []);
      setMeta(so?.metadata ?? {});
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load sales order");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (id) load(id);
  }, [id]);

  function reservedFor(lineId: string) {
    const map = meta?.reservedMap || {};
    const v = Number(map?.[lineId] ?? 0);
    return Number.isFinite(v) ? v : 0;
  }
  function fulfilledFor(ln: any) {
    const v = Number(ln?.qtyFulfilled ?? 0);
    return Number.isFinite(v) ? v : 0;
  }
  function backorderedFor(ln: any) {
    const ordered = Number(ln?.qty ?? 0);
    const fulfilled = fulfilledFor(ln);
    const resv = reservedFor(String(ln?.id));
    const remaining = Math.max(0, ordered - fulfilled - resv);
    return remaining;
  }

  // Generic SO action POSTer
  async function callSoAction(
    action: "submit" | "commit" | "reserve" | "release" | "fulfill",
    body?: any
  ) {
    if (!id) throw new Error("Sales order not yet created");
    const path = `/sales/so/${encodeURIComponent(id)}:${action}`;

    // Prefer shared api() helper if available
    if (api) return api(path, { method: "POST", body });

    // Fallback to fetch – reuse same base URL & auth that your client uses.
    // @ts-ignore read from your client module if exported (common in this repo)
    const { API_BASE, getBearer } = require("../api/client");
    const base: string = API_BASE || process.env.MBAPP_API_BASE || "";
    const bearer: string | undefined =
      (typeof getBearer === "function" && (await getBearer())) ||
      process.env.MBAPP_BEARER;
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    const json = txt ? JSON.parse(txt) : {};
    if (!res.ok) {
      const msg = json?.message || `HTTP ${res.status}`;
      const err: any = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  async function onCreateDraft() {
    if (!customerName.trim()) return Alert.alert("Validation", "Customer name is required.");
    setSaving(true);
    try {
      const created = await createObject<any>("salesOrder", {
        type: "salesOrder",
        customerName: customerName.trim(),
        status: "draft",
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: [],
      });
      setId(String(created?.id));
      setMeta(created?.metadata ?? {});
      Alert.alert("Created", "Draft sales order created.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to create order");
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!id) return;
    if (!customerName.trim()) return Alert.alert("Validation", "Customer name is required.");
    setSaving(true);
    try {
      const updated = await updateObject<any>("salesOrder", id, {
        customerName: customerName.trim(),
        status,
        ...(notes.trim() ? { notes: notes.trim() } : { notes: undefined }),
      });
      setLines(Array.isArray(updated?.lines) ? updated.lines : lines);
      setMeta(updated?.metadata ?? {});
      setStatus(String(updated?.status ?? status));
      Alert.alert("Saved", "Sales order updated.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // --- SO actions (buttons) --------------------------------------------------

  async function doSubmit() {
    if (!id) return;
    setActing(true);
    try { await callSoAction("submit"); await load(); }
    catch (e: any) { Alert.alert("Submit failed", e?.message ?? ""); }
    finally { setActing(false); }
  }

  async function doCommit({ strict = false }: { strict?: boolean } = {}) {
    if (!id) return;
    setActing(true);
    try {
      // By default non-strict (records shortages/backorders, no 409)
      const body = strict ? { strict: true } : undefined;
      await callSoAction("commit", body);
      await load();
    } catch (e: any) {
      Alert.alert("Commit failed", e?.message ?? "");
    } finally {
      setActing(false);
    }
  }

  async function doReserveAll() {
    if (!id) return;
    setActing(true);
    try {
      const linesPayload = lines.map((ln) => {
        const lineId = String(ln.id);
        const ordered = Number(ln.qty ?? 0);
        const fulfilled = fulfilledFor(ln);
        const already = reservedFor(lineId);
        const remaining = Math.max(0, ordered - fulfilled - already);
        return remaining > 0 ? { lineId, deltaQty: remaining } : null;
      }).filter(Boolean);
      if (!linesPayload.length) return;
      await callSoAction("reserve", { lines: linesPayload });
      await load();
    } catch (e: any) {
      Alert.alert("Reserve failed", e?.message ?? "");
    } finally {
      setActing(false);
    }
  }

  async function doReleaseAll() {
    if (!id) return;
    setActing(true);
    try {
      const linesPayload = Object.entries(meta?.reservedMap || {})
        .map(([lineId, v]) => ({ lineId, deltaQty: Math.max(0, Number(v || 0)) }))
        .filter((x) => x.deltaQty > 0);
      if (!linesPayload.length) return;
      await callSoAction("release", { lines: linesPayload });
      await load();
    } catch (e: any) {
      Alert.alert("Release failed", e?.message ?? "");
    } finally {
      setActing(false);
    }
  }

  async function doFulfillAll() {
    if (!id) return;
    setActing(true);
    try {
      // Fulfill only up to reserved on each line
      const linesPayload = Object.entries(meta?.reservedMap || {})
        .map(([lineId, v]) => ({ lineId, deltaQty: Math.max(0, Number(v || 0)) }))
        .filter((x) => x.deltaQty > 0);
      if (!linesPayload.length) return;
      await callSoAction("fulfill", { lines: linesPayload });
      await load();
    } catch (e: any) {
      Alert.alert("Fulfill failed", e?.message ?? "");
    } finally {
      setActing(false);
    }
  }

  async function doLineQuick(lineId: string, delta: number, kind: "reserve" | "release" | "fulfill") {
    if (!id || !delta) return;
    setActing(true);
    try {
      await callSoAction(kind, { lines: [{ lineId, deltaQty: Math.abs(delta) }] });
      await load();
    } catch (e: any) {
      const label = kind.charAt(0).toUpperCase() + kind.slice(1);
      Alert.alert(`${label} failed`, e?.message ?? "");
    } finally {
      setActing(false);
    }
  }

  // --- UI --------------------------------------------------------------------

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Scanner card */}
      <ScannerPanel
        soId={id}
        initialCollapsed={!Boolean(params?.expandScanner)}
        defaultMode={id ? "add" : "receive"}
        onLinesChanged={(next) => { setLines(next || []); load(); }}
      />

      {/* Info Card */}
      <View
        style={{
          backgroundColor: t.colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: 16,
          gap: 8,
        }}
      >
        <Field label="Customer *" value={customerName} onChangeText={setCustomerName} />
        {id ? (
          <>
            <Label text="Status" />
            <PillGroup
              options={STATUS_VALUES as unknown as string[]}
              value={status}
              onChange={setStatus}
            />
          </>
        ) : null}
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <Btn text={id ? (saving ? "Saving…" : "Save") : (saving ? "Creating…" : "Create Draft")}
               onPress={id ? onSave : onCreateDraft}
               disabled={saving || acting} />
          {id && (
            <>
              <Btn text="Submit" onPress={doSubmit} disabled={acting} />
              <Btn text="Commit" onPress={() => doCommit()} disabled={acting} />
              {/* strict mode if you need it: <Btn text="Commit (strict)" onPress={() => doCommit({ strict: true })} disabled={acting} /> */}
              <Btn text="Reserve All" onPress={doReserveAll} disabled={acting} />
              <Btn text="Release All" onPress={doReleaseAll} disabled={acting} />
              <Btn text="Fulfill All" onPress={doFulfillAll} disabled={acting} />
              <Btn text="Refresh" onPress={() => load()} disabled={acting} />
            </>
          )}
        </View>
      </View>

      {/* Lines */}
      <View
        style={{
          backgroundColor: t.colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: 16,
          marginBottom: 4,
        }}
      >
        <Label text="Lines" />
        {loading ? (
          <ActivityIndicator />
        ) : lines.length ? (
          lines.map((ln, idx) => {
            const lineId = String((ln as any).id ?? `L${idx + 1}`);
            const itemId = String((ln as any).itemId || "—");
            const qty = Number((ln as any).qty ?? 0);
            const res = reservedFor(lineId);
            const ful = fulfilledFor(ln);
            const back = backorderedFor(ln);

            return (
              <View
                key={lineId}
                style={{
                  paddingVertical: 10,
                  borderBottomWidth: idx < lines.length - 1 ? 1 : 0,
                  borderBottomColor: t.colors.border,
                  gap: 6,
                }}
              >
                <Text style={{ color: t.colors.text, fontWeight: "600" as const }}>
                  {itemId}
                </Text>
                <Text style={{ color: t.colors.muted }}>
                  Ordered: {qty}
                </Text>
                {/* Badges */}
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Badge label={`Reserved ${res}`} tone="info" />
                  <Badge label={`Fulfilled ${ful}`} tone="success" />
                  <Badge label={`Backordered ${back}`} tone={back > 0 ? "warn" : "muted"} />
                </View>

                {/* Per-line quick actions */}
                {id ? (
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {/* Reserve 1 only if there’s backorder */}
                    <Btn text="+Reserve 1" onPress={() => doLineQuick(lineId, 1, "reserve")} disabled={acting || back <= 0} />
                    {/* Release 1 only if we have reserved */}
                    <Btn text="Release 1" onPress={() => doLineQuick(lineId, 1, "release")} disabled={acting || res <= 0} />
                    {/* Fulfill 1 only if reserved > 0 */}
                    <Btn text="Fulfill 1" onPress={() => doLineQuick(lineId, 1, "fulfill")} disabled={acting || res <= 0} />
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <Text style={{ color: t.colors.muted }}>No lines yet.</Text>
        )}
      </View>
    </ScrollView>
  );
}

/* --- Tiny UI atoms --- */

function Btn({ text, onPress, disabled }: { text: string; onPress: () => void; disabled?: boolean }) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: t.colors.primary,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" as const }}>{text}</Text>
    </Pressable>
  );
}

function Badge({ label, tone = "muted" }: { label: string; tone?: "info" | "success" | "warn" | "muted" }) {
  const t = useColors();
  const palette = {
    info:   { bg: t.colors.card,   border: t.colors.border, text: t.colors.text },
    success:{ bg: t.colors.card,   border: t.colors.border, text: t.colors.text },
    warn:   { bg: t.colors.card,   border: t.colors.border, text: t.colors.text },
    muted:  { bg: t.colors.card,   border: t.colors.border, text: t.colors.muted },
  }[tone];
  return (
    <View style={{
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.bg,
    }}>
      <Text style={{ color: palette.text, fontWeight: "600" as const }}>{label}</Text>
    </View>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
  keyboardType,
}: {
  label: string;
  value?: any;
  onChangeText: (v: any) => void;
  multiline?: boolean;
  keyboardType?: any;
}) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ marginBottom: 6, color: t.colors.muted }}>{label}</Text>
      <TextInput
        value={String(value ?? "")}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: t.colors.bg,
          color: t.colors.text,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}

function PillGroup({
  options,
  value,
  onChange,
}: {
  options: string[];
  value?: string;
  onChange: (v: string) => void;
}) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: selected ? t.colors.primary : t.colors.border,
              backgroundColor: selected ? t.colors.primary : t.colors.card,
            }}
          >
            <Text
              style={{
                color: selected ? t.colors.buttonText : t.colors.text,
                fontWeight: "600" as const,
              }}
            >
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
