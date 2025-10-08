import * as React from "react";
import {
  View, Text, Pressable, TextInput, Alert, Vibration, Switch, type TextStyle,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { apiClient } from "../../api/client";
import { useColors } from "./useColors";

type BuiltInAction = "receive" | "pick" | "count";
type BuiltInMode = "add" | BuiltInAction;

type ExtraMode = { key: string; label: string; run: (epc: string) => Promise<void> };

export function ScannerPanel({
  soId,
  expanded = false,             // now: initial CAMERA state only
  defaultMode = "add",
  extraModes = [],
  onLinesChanged,
}: {
  soId?: string;
  expanded?: boolean;
  defaultMode?: BuiltInMode;     // "add" | "receive" | "pick" | "count"
  extraModes?: ExtraMode[];
  onLinesChanged?: (nextLines: Array<{ id?: string; itemId: string; qty: number }>) => void;
}) {
  const t = useColors();

  // Manual input is ALWAYS visible now
  const [showCamera, setShowCamera] = React.useState<boolean>(Boolean(expanded));

  const [mode, setMode] = React.useState<BuiltInMode | { extraKey: string }>(defaultMode);
  const [permission, requestPermission] = useCameraPermissions();

  // Start/stop session whenever we're in a built-in action mode
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const isBuiltInAction = mode === "receive" || mode === "pick" || mode === "count";

  React.useEffect(() => {
    let cancelled = false;
    if (!isBuiltInAction) return;
    (async () => {
      try {
        const res = await apiClient.post<{ id: string }>("/scanner/sessions", { op: "start" });
        if (!cancelled) setSessionId(res.id);
      } catch (e: any) {
        if (!cancelled) Alert.alert("Scanner", e?.message ?? "Failed to start session");
      }
    })();
    return () => {
      cancelled = true;
      if (sessionId) apiClient.post("/scanner/sessions", { op: "stop", sessionId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBuiltInAction]);

  React.useEffect(() => {
    if (showCamera && !permission?.granted) requestPermission().catch(() => {});
  }, [showCamera, permission?.granted, requestPermission]);

  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const lastRef = React.useRef<{ data?: string; at?: number }>({});

  async function resolveEpc(epc: string): Promise<{ itemId: string; status?: string }> {
    const res = await apiClient.get<{ itemId: string; status?: string }>(
      `/epc/resolve?epc=${encodeURIComponent(epc)}`
    );
    if (!res?.itemId) throw new Error("EPC not found");
    return res;
  }

  async function addLineFromEpc(epc: string) {
    if (!soId) return Alert.alert("Sales Order", "Create/Load the order first.");
    const { itemId } = await resolveEpc(epc);
    const so = await apiClient.get<any>(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    const next = Array.isArray(so?.lines) ? [...so.lines, { itemId, qty: 1 }] : [{ itemId, qty: 1 }];
    const updated = await apiClient.put<any>(`/objects/salesOrder/${encodeURIComponent(soId)}`, { lines: next });
    onLinesChanged?.(Array.isArray(updated?.lines) ? updated.lines : next);
    Vibration.vibrate(10);
  }

  async function postAction(epc: string, kind: BuiltInAction) {
    if (!sessionId) throw new Error("Session not ready yet");
    const headers: Record<string, string> = {};
    if (kind === "receive") headers["Idempotency-Key"] = `scan-${epc}`;
    await apiClient.post("/scanner/actions", { sessionId, epc, action: kind }, headers);
    Vibration.vibrate(10);
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
        }
        setCode("");
      } catch (e: any) {
        Alert.alert("Scan", e?.message ?? "Operation failed");
      } finally {
        setBusy(false);
      }
    },
    [mode, code, soId, sessionId, extraModes]
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
      : (extraModes.find(m => "extraKey" in mode && m.key === (mode as any).extraKey)?.label || "Run");

  const disabled =
    (mode === "add" && !soId) ||
    ((mode === "receive" || mode === "pick" || mode === "count") && !sessionId) ||
    busy;

  return (
    <View
      style={{
        backgroundColor: t.colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.colors.border,
        overflow: "hidden",
      }}
    >
      {/* Header: pills + session indicator (for built-in actions) + camera toggle */}
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center", flex: 1 }}>
            <Pill label="Add Line" active={mode === "add"} onPress={() => setMode("add")} t={t} />
            <Pill label="Receive" active={mode === "receive"} onPress={() => setMode("receive")} t={t} />
            <Pill label="Pick" active={mode === "pick"} onPress={() => setMode("pick")} t={t} />
            <Pill label="Count" active={mode === "count"} onPress={() => setMode("count")} t={t} />
            {extraModes.map((em) => (
              <Pill
                key={em.key}
                label={em.label}
                active={typeof mode === "object" && "extraKey" in mode && mode.extraKey === em.key}
                onPress={() => setMode({ extraKey: em.key })}
                t={t}
              />
            ))}
            {(mode === "receive" || mode === "pick" || mode === "count") && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 6 }}>
                <Text style={{ color: t.colors.muted }}>Session</Text>
                <Switch value={Boolean(sessionId)} disabled />
              </View>
            )}
          </View>

          <Pressable
            onPress={() => setShowCamera((v) => !v)}
            hitSlop={10}
            style={{
              width: 40, height: 40, borderRadius: 20,
              alignItems: "center", justifyContent: "center",
              borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card, marginLeft: 8,
            }}
          >
            <Feather name={showCamera ? "camera-off" : "camera"} size={20} color={t.colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Camera (optional) */}
      {showCamera ? (
        permission?.granted ? (
          <View style={{ height: 240, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
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
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <Text style={{ color: t.colors.danger, marginBottom: 8 }}>Camera permission is required.</Text>
            <Pressable
              onPress={() => requestPermission()}
              style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}
            >
              <Text style={{ color: t.colors.text }}>Grant Permission</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <Text style={{ color: t.colors.muted }}>Requesting camera permission…</Text>
          </View>
        )
      ) : null}

      {/* Manual input: ALWAYS visible */}
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ color: t.colors.muted }}>Manual EPC / Code</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Type or paste code"
          placeholderTextColor={t.colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={() => handleSubmit()}
          style={{
            backgroundColor: t.colors.bg,
            color: t.colors.text,
            borderColor: t.colors.border,
            borderWidth: 1,
            borderRadius: 8,
            padding: 12,
          }}
        />
        <PrimaryButton
          title={busy ? `${primaryLabel}…` : primaryLabel}
          onPress={() => handleSubmit()}
          disabled={disabled}
          t={t}
        />
      </View>
    </View>
  );
}

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
