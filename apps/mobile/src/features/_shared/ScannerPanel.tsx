//apps/mobile/src/features/_shared/ScannerPanel.tsx
import * as React from "react";
import {
  View, Text, Pressable, TextInput, Vibration, type TextStyle,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { apiClient } from "../../api/client";
import { useColors } from "./useColors";
import { useToast } from "./Toast";
import { resolveEpc } from "./epc";
import { useScannerSession } from "./useScannerSession";

type BuiltInAction = "receive" | "pick" | "count";
type BuiltInMode = "add" | BuiltInAction | "smartPick";
type ExtraMode = { key: string; label: string; run: (epc: string) => Promise<void> };

export function ScannerPanel({
  soId,
  initialCollapsed = true,
  defaultMode = "add",
  extraModes = [],
  onLinesChanged,
}: {
  soId?: string;
  initialCollapsed?: boolean;
  defaultMode?: BuiltInMode;                 // "add" | "receive" | "pick" | "count" | "smartPick"
  extraModes?: ExtraMode[];
  onLinesChanged?: (next: Array<{ id?: string; itemId: string; qty: number }>) => void;
}) {
  const t = useColors();
  const toast = useToast();

  const [collapsed, setCollapsed] = React.useState<boolean>(initialCollapsed);
  const [showCamera, setShowCamera] = React.useState<boolean>(false);
  const [mode, setMode] = React.useState<BuiltInMode | { extraKey: string }>(defaultMode);

  const [permission, requestPermission] = useCameraPermissions();

  const isAction =
    mode === "receive" || mode === "pick" || mode === "count" || mode === "smartPick";
  const sessionId = useScannerSession(!collapsed && isAction);

  React.useEffect(() => {
    if (showCamera && !permission?.granted) requestPermission().catch(() => {});
  }, [showCamera, permission?.granted, requestPermission]);

  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const lastRef = React.useRef<{ data?: string; at?: number }>({});

  // ---- helpers ----
  async function addLineFromEpc(epc: string) {
    if (!soId) { toast("Open or create an order first.", "error"); return; }
    const { itemId } = await resolveEpc(epc);
    const so = await apiClient.get<any>(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    const next = Array.isArray(so?.lines) ? [...so.lines, { itemId, qty: 1 }] : [{ itemId, qty: 1 }];
    const updated = await apiClient.put<any>(`/objects/salesOrder/${encodeURIComponent(soId)}`, { lines: next });
    onLinesChanged?.(Array.isArray(updated?.lines) ? updated.lines : next);
    Vibration.vibrate(10);
    toast("Line added", "success");
  }

  async function postAction(epc: string, kind: Exclude<BuiltInAction, never>) {
    if (!sessionId) throw new Error("Session not ready yet");
    const headers: Record<string, string> = {};
    if (kind === "receive") headers["Idempotency-Key"] = `scan-${epc}`;
    await apiClient.post("/scanner/actions", { sessionId, epc, action: kind }, headers);
    Vibration.vibrate(10);
    toast(kind === "receive" ? "Received" : kind === "pick" ? "Picked" : "Counted", "success");
  }

  async function smartPick(epc: string) {
    if (!soId) throw new Error("No sales order context");
    if (!sessionId) throw new Error("Session not ready yet");

    // 1) resolve tag → itemId
    const { itemId } = await resolveEpc(epc);

    // 2) fetch SO + compute eligible line (remaining to ship/reserve)
    const so = await apiClient.get<any>(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    const lines: any[] = Array.isArray(so?.lines) ? so.lines : [];
    const reservedMap: Record<string, number> = { ...(so?.metadata?.reservedMap || {}) };

    const findEligible = () => {
      for (const l of lines) {
        if (String(l.itemId) !== String(itemId)) continue;
        const ordered = Number(l.qty ?? 0);
        const fulfilled = Number(l.qtyFulfilled ?? 0);
        const reserved = Math.max(0, Number(reservedMap[String(l.id)] ?? 0));
        const remainingToShip = Math.max(0, ordered - fulfilled);
        const remainingToReserve = Math.max(0, remainingToShip - reserved);
        if (remainingToShip > 0 && remainingToReserve > 0) return l;
      }
      return null;
    };

    const target = findEligible();
    if (!target) {
      throw new Error("No matching line to reserve (already fulfilled or fully reserved).");
    }

    // 3) reserve exactly 1 on that line (idempotency scoped to so+line+epc)
    const idem = `sprsv-${soId}-${target.id}-${epc}`;
    await apiClient.post(
      `/sales/so/${encodeURIComponent(soId)}:reserve`,
      { lines: [{ lineId: target.id, deltaQty: 1 }] },
      { "Idempotency-Key": idem }
    );

    // 4) post scanner pick (this will consume on-hand & reserved)
    await postAction(epc, "pick");
  }

  const handleSubmit = React.useCallback(
    async (raw?: string) => {
      const epc = String((raw ?? code) || "").trim();
      if (!epc) return;
      setBusy(true);
      try {
        if (mode === "add") {
          await addLineFromEpc(epc);
        } else if (mode === "receive" || mode === "pick" || mode === "count") {
          await resolveEpc(epc);
          await postAction(epc, mode);
        } else if (mode === "smartPick") {
          await smartPick(epc);
          // success toast happens in postAction("pick")
        } else if (typeof mode === "object" && "extraKey" in mode) {
          const extra = extraModes.find(m => m.key === mode.extraKey);
          if (!extra) throw new Error("Unknown action");
          await extra.run(epc);
          Vibration.vibrate(10);
          toast("Action completed", "success");
        }
        setCode("");
      } catch (e: any) {
        // Normalize common guardrail messages a bit
        const msg = String(e?.message || e);
        toast(
          /insufficient_onhand|INSUFFICIENT|reserve|fulfilled|reserved/i.test(msg)
            ? msg
            : "Operation failed",
          "error"
        );
      } finally {
        setBusy(false);
      }
    },
    [mode, code, soId, sessionId, extraModes, toast]
  );

  const onBarcodeScanned = React.useCallback(
    ({ data }: { data: string }) => {
      const d = String(data || "").trim();
      if (!d) return;
      const now = Date.now();
      const last = lastRef.current;
      if (last.data === d && last.at && now - last.at < 1200) return; // debounce
      lastRef.current = { data: d, at: now };
      void handleSubmit(d);
    },
    [handleSubmit]
  );

  const primaryLabel =
    mode === "add"
      ? "Add Line"
      : mode === "receive"
      ? "Receive"
      : mode === "pick"
      ? "Pick"
      : mode === "count"
      ? "Count"
      : "Smart Pick";

  const disabled =
    (mode === "add" && !soId) ||
    ((mode === "receive" || mode === "pick" || mode === "count" || mode === "smartPick") && !sessionId) ||
    busy;

  // ---------- UI ----------
  return (
    <View style={{
      backgroundColor: t.colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.colors.border,
      overflow: "hidden",
    }}>
      {collapsed ? (
        // COLLAPSED: barcode icon (left) + chevron (right)
        <View
          style={{
            height: 44,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <MaterialCommunityIcons name="barcode-scan" size={22} color={t.colors.muted} />
          <Pressable
            onPress={() => { setCollapsed(false); setShowCamera(false); }}
            hitSlop={10}
            style={{ padding: 6 }}
          >
            <Feather name="chevron-down" size={22} color={t.colors.text} />
          </Pressable>
        </View>
      ) : (
        <>
          {/* Expanded: action pills (+ Smart Pick if soId present) + right chevron to collapse */}
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center", flex: 1 }}>
                <Pill label="Add Line"   active={mode === "add"}        onPress={() => setMode("add")}        t={t} />
                <Pill label="Receive"    active={mode === "receive"}    onPress={() => setMode("receive")}    t={t} />
                <Pill label="Pick"       active={mode === "pick"}       onPress={() => setMode("pick")}       t={t} />
                <Pill label="Count"      active={mode === "count"}      onPress={() => setMode("count")}      t={t} />
                {soId ? (
                  <Pill label="Smart Pick" active={mode === "smartPick"} onPress={() => setMode("smartPick")} t={t} />
                ) : null}
                {extraModes.map((em) => (
                  <Pill
                    key={em.key}
                    label={em.label}
                    active={typeof mode === "object" && "extraKey" in mode && mode.extraKey === em.key}
                    onPress={() => setMode({ extraKey: em.key })}
                    t={t}
                  />
                ))}
              </View>

              <Pressable
                onPress={() => setCollapsed(true)}
                hitSlop={10}
                style={{
                  width: 40, height: 40, borderRadius: 20,
                  alignItems: "center", justifyContent: "center",
                  borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card, marginLeft: 8,
                }}
              >
                <Feather name="chevron-up" size={20} color={t.colors.text} />
              </Pressable>
            </View>
          </View>

          {/* Input row with camera toggle adornment */}
          <View style={{ padding: 12, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="Type or scan EPC / Code"
                placeholderTextColor={t.colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                onSubmitEditing={() => handleSubmit()}
                style={{
                  flex: 1,
                  backgroundColor: t.colors.bg,
                  color: t.colors.text,
                  borderColor: t.colors.border,
                  borderWidth: 1,
                  borderTopLeftRadius: 8,
                  borderBottomLeftRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                }}
              />
              <Pressable
                onPress={() => setShowCamera(v => !v)}
                hitSlop={10}
                style={{
                  width: 44,
                  height: 44,
                  borderTopRightRadius: 8,
                  borderBottomRightRadius: 8,
                  borderWidth: 1,
                  borderLeftWidth: 0,
                  borderColor: t.colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: t.colors.card,
                }}
              >
                <Feather name={showCamera ? "camera-off" : "camera"} size={18} color={t.colors.text} />
              </Pressable>
            </View>

            <PrimaryButton
              title={busy ? `${primaryLabel}…` : primaryLabel}
              onPress={() => handleSubmit()}
              disabled={disabled}
              t={t}
            />
          </View>

          {/* Camera view (hidden by default; toggled by adornment) */}
          {showCamera ? (
            permission?.granted ? (
              <View style={{ height: 240, borderTopWidth: 1, borderTopColor: t.colors.border }}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  onBarcodeScanned={onBarcodeScanned}
                  barcodeScannerSettings={{
                    barcodeTypes: [
                      "qr",
                      "code128", "code39", "code93",
                      "ean13", "ean8", "upc_a", "upc_e",
                      "itf14", "pdf417", "datamatrix", "aztec",
                    ],
                  }}
                />
              </View>
            ) : permission?.granted === false ? (
              <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: t.colors.border }}>
                <Text style={{ color: t.colors.muted }}>Camera permission required.</Text>
                <Pressable
                  onPress={() => requestPermission()}
                  style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}
                >
                  <Text style={{ color: t.colors.text }}>Grant Permission</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: t.colors.border }}>
                <Text style={{ color: t.colors.muted }}>Requesting camera permission…</Text>
              </View>
            )
          ) : null}
        </>
      )}
    </View>
  );
}

/* --- small UI helpers --- */
function Pill({ label, active, onPress, t }:{
  label: string; active: boolean; onPress: () => void; t: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? t.colors.primary : t.colors.border,
        backgroundColor: active ? t.colors.primary : t.colors.card,
      }}
    >
      <Text style={{ color: active ? t.colors.buttonText : t.colors.text }}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({ title, onPress, disabled, t }:{
  title: string; onPress: () => void; disabled?: boolean; t: ReturnType<typeof useColors>;
}) {
  const style: TextStyle = { color: t.colors.buttonText, fontWeight: "700" as const, textAlign: "center" };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: t.colors.primary,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={style}>{title}</Text>
    </Pressable>
  );
}
