// apps/mobile/src/features/_shared/ScannerPanel.tsx
import * as React from "react";
import {
  View, Text, Pressable, TextInput, Vibration, type TextStyle,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { apiClient } from "../../api/client";
import { useColors } from "./useColors";

type BuiltInAction = "receive" | "pick" | "count";
type BuiltInMode = "add" | BuiltInAction;
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
  defaultMode?: BuiltInMode;                 // "add" | "receive" | "pick" | "count"
  extraModes?: ExtraMode[];
  onLinesChanged?: (next: Array<{ id?: string; itemId: string; qty: number }>) => void;
}) {
  const t = useColors();

  const [collapsed, setCollapsed] = React.useState<boolean>(initialCollapsed);
  const [showCamera, setShowCamera] = React.useState<boolean>(false);
  const [mode, setMode] = React.useState<BuiltInMode | { extraKey: string }>(defaultMode);

  const [permission, requestPermission] = useCameraPermissions();

  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const isAction = mode === "receive" || mode === "pick" || mode === "count";

  // Inline toast state
  const [toast, setToast] = React.useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToast = React.useCallback((msg: string, kind: "success" | "error" = "success", dur = 1800) => {
    if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null; }
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => { setToast(null); toastTimer.current = null; }, dur);
  }, []);
  React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  React.useEffect(() => {
    let cancelled = false;
    if (collapsed || !isAction) return;
    (async () => {
      try {
        const res = await apiClient.post<{ id: string }>("/scanner/sessions", { op: "start" });
        if (!cancelled) setSessionId(res.id);
      } catch (e: any) {
        if (!cancelled) pushToast(String(e?.message ?? "Failed to start session"), "error");
      }
    })();
    return () => {
      cancelled = true;
      if (sessionId) apiClient.post("/scanner/sessions", { op: "stop", sessionId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, isAction]);

  React.useEffect(() => {
    if (showCamera && !permission?.granted) requestPermission().catch(() => {});
  }, [showCamera, permission?.granted, requestPermission]);

  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const lastRef = React.useRef<{ data?: string; at?: number }>({});

  async function resolveEpc(epc: string) {
    const res = await apiClient.get<{ itemId: string; status?: string }>(
      `/epc/resolve?epc=${encodeURIComponent(epc)}`
    );
    if (!res?.itemId) throw new Error("EPC not found");
    return res;
  }

  async function addLineFromEpc(epc: string) {
    if (!soId) { pushToast("Open or create an order first.", "error"); return; }
    const { itemId } = await resolveEpc(epc);
    const so = await apiClient.get<any>(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    const next = Array.isArray(so?.lines) ? [...so.lines, { itemId, qty: 1 }] : [{ itemId, qty: 1 }];
    const updated = await apiClient.put<any>(`/objects/salesOrder/${encodeURIComponent(soId)}`, { lines: next });
    onLinesChanged?.(Array.isArray(updated?.lines) ? updated.lines : next);
    Vibration.vibrate(10);
    pushToast("Line added", "success");
  }

  async function postAction(epc: string, kind: BuiltInAction) {
    if (!sessionId) throw new Error("Session not ready yet");
    const headers: Record<string, string> = {};
    if (kind === "receive") headers["Idempotency-Key"] = `scan-${epc}`;
    await apiClient.post("/scanner/actions", { sessionId, epc, action: kind }, headers);
    Vibration.vibrate(10);
    pushToast(kind === "receive" ? "Received" : kind === "pick" ? "Picked" : "Counted", "success");
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
        } else if (typeof mode === "object" && "extraKey" in mode) {
          const extra = extraModes.find(m => m.key === mode.extraKey);
          if (!extra) throw new Error("Unknown action");
          await extra.run(epc);
          Vibration.vibrate(10);
          pushToast("Action completed", "success");
        }
        setCode("");
      } catch (e: any) {
        pushToast(String(e?.message || "Operation failed"), "error");
      } finally {
        setBusy(false);
      }
    },
    [mode, code, soId, sessionId, extraModes, pushToast]
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
      : "Count";

  const disabled =
    (mode === "add" && !soId) ||
    ((mode === "receive" || mode === "pick" || mode === "count") && !sessionId) ||
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
          {/* Expanded: action pills + right chevron to collapse */}
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center", flex: 1 }}>
                <Pill label="Add Line" active={mode === "add"} onPress={() => setMode("add")} t={t} />
                <Pill label="Receive" active={mode === "receive"} onPress={() => setMode("receive")} t={t} />
                <Pill label="Pick"    active={mode === "pick"}    onPress={() => setMode("pick")}    t={t} />
                <Pill label="Count"   active={mode === "count"}   onPress={() => setMode("count")}   t={t} />
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

      {/* Inline toast renderer */}
      {toast ? <InlineToast t={t} toast={toast} /> : null}
    </View>
  );
}

/* --- helpers --- */
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

function InlineToast({ t, toast }:{ t: ReturnType<typeof useColors>, toast:{ msg:string; kind:"success"|"error" } }) {
  const bg = toast.kind === "success" ? (t.colors.success ?? "#0a7") : (t.colors.danger ?? "#c33");
  const fg = t.colors.buttonText || "#fff";
  return (
    <View style={{
      position: "absolute",
      bottom: 12,
      left: 12,
      right: 12,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: bg,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 5,
    }}>
      <Text style={{ color: fg, fontWeight: "700" }}>{toast.msg}</Text>
    </View>
  );
}
