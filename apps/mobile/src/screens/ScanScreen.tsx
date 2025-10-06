// apps/mobile/src/screens/ScanScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert, SectionList, ListRenderItemInfo, Vibration, Switch } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useColors } from "../features/_shared/useColors";
import { apiClient } from "../api/client";
import { Feather } from "@expo/vector-icons";


type ActionKind = "receive" | "pick" | "count";
type HistoryRow = { id: string; ts: string; epc: string; action: ActionKind; itemId?: string; status?: number; err?: string };

export default function ScanScreen() {
  const t = useColors();
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [epc, setEpc] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [resolved, setResolved] = React.useState<{ itemId?: string; status?: string } | null>(null);
  const [history, setHistory] = React.useState<HistoryRow[]>([]);

  // Camera (expo-camera)
  const [showCamera, setShowCamera] = React.useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const [autoReceive, setAutoReceive] = React.useState(true);
  const lastScanRef = React.useRef<{ code?: string; at?: number }>({});

  // Start/stop scanner session
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
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
    }, [])
  );

  React.useEffect(() => {
    if (showCamera && !permission?.granted) requestPermission().catch(() => {});
  }, [showCamera, permission?.granted, requestPermission]);

  async function resolveEpc(code?: string) {
    const tag = (code ?? epc).trim();
    if (!tag) return;
    try {
      const res = await apiClient.get<{ itemId: string; status?: string }>(`/epc/resolve?epc=${encodeURIComponent(tag)}`);
      setResolved(res);
      return res;
    } catch (e: any) {
      setResolved(null);
      throw e;
    }
  }

  async function doAction(kind: ActionKind, tagOverride?: string) {
    const tag = (tagOverride ?? epc).trim();
    if (!tag) return Alert.alert("Scanner", "Enter or scan an EPC first.");
    if (!sessionId) return Alert.alert("Scanner", "Session not ready yet. Try again in a moment.");

    setBusy(true);
    const ts = new Date().toISOString();
    const idempotencyKey = kind === "receive" ? `scan-${tag}` : undefined;

    try {
      try { await resolveEpc(tag); } catch { throw new Error(`EPC not found (${tag})`); }
      await apiClient.post(
        "/scanner/actions",
        { sessionId, epc: tag, action: kind },
        idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined
      );

      setHistory((h) => [
        { id: `${ts}-${Math.random()}`, ts, epc: tag, action: kind, itemId: resolved?.itemId, status: 200 },
        ...h.slice(0, 49),
      ]);
      if (kind === "receive") setEpc("");
    } catch (e: any) {
      const msg = e?.message || "Failed";
      setHistory((h) => [
        { id: `${ts}-${Math.random()}`, ts, epc: tag, action: kind, itemId: resolved?.itemId, err: msg, status: 0 },
        ...h.slice(0, 49),
      ]);
      Alert.alert("Scanner", msg);
    } finally {
      setBusy(false);
    }
  }

  // Camera barcode handler (debounced)
  const onBarcodeScanned = React.useCallback(
    async ({ data }: { data: string }) => {
      const code = String(data || "").trim();
      if (!code) return;
      const now = Date.now();
      const last = lastScanRef.current;
      if (last.code === code && last.at && now - last.at < 1500) return; // debounce same code < 1.5s
      lastScanRef.current = { code, at: now };
      Vibration.vibrate(10);
      setEpc(code);
      if (autoReceive && !busy) await doAction("receive", code);
    },
    [autoReceive, busy] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const Header = (
    <View style={{ padding: 16 }}>
      <View
        style={{
          backgroundColor: t.colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <View style={{ marginBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: t.colors.muted }}>
            {sessionId ? `Session: ${sessionId.slice(0, 8)}…` : "Starting session…"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: t.colors.muted }}>Auto-Receive</Text>
              <Switch value={autoReceive} onValueChange={setAutoReceive} />
            </View>
            <Pressable
              onPress={() => setShowCamera((v) => !v)}
              accessibilityLabel={showCamera ? "Hide camera" : "Show camera"}
              hitSlop={10}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: t.colors.border,
                backgroundColor: t.colors.card,
              }}
            >
              <Feather
                name={showCamera ? "camera-off" : "camera"}
                size={20}
                color={t.colors.text}
              />
            </Pressable>

          </View>
        </View>

        {showCamera ? (
          permission?.granted ? (
            <View
              style={{
                overflow: "hidden",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.colors.border,
                marginBottom: 12,
              }}
            >
              <CameraView
                style={{ width: "100%", height: 260 }}
                facing="back"
                // Accept most codes (omit barcodeScannerSettings to allow all)
                onBarcodeScanned={(e) => {
                  // e has { data, type, cornerPoints } on SDK 50+
                  onBarcodeScanned({ data: e.data });
                }}
              />
            </View>
          ) : permission?.granted === false ? (
            <Text style={{ color: t.colors.danger, marginBottom: 10 }}>Camera permission denied</Text>
          ) : (
            <Text style={{ color: t.colors.muted, marginBottom: 10 }}>Requesting camera permission…</Text>
          )
        ) : null}

        <Text style={{ marginBottom: 6, color: t.colors.muted }}>EPC</Text>
        <TextInput
          value={epc}
          onChangeText={setEpc}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Scan or type EPC"
          placeholderTextColor={t.colors.muted}
          style={{
            backgroundColor: t.colors.bg,
            color: t.colors.text,
            borderColor: t.colors.border,
            borderWidth: 1,
            borderRadius: 8,
            padding: 12,
            marginBottom: 10,
          }}
        />

        {resolved?.itemId ? (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ color: t.colors.muted }}>
              Resolved ➜ itemId: <Text style={{ color: t.colors.text }}>{resolved.itemId}</Text>{" "}
              {resolved.status ? `(status: ${resolved.status})` : ""}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Button title="Receive" onPress={() => doAction("receive")} disabled={busy} theme={t} />
          <Button title="Pick" onPress={() => doAction("pick")} disabled={busy} theme={t} />
          <Button title="Count" onPress={() => doAction("count")} disabled={busy} theme={t} />
        </View>
      </View>

      <Text style={{ color: t.colors.muted, marginBottom: 8, marginLeft: 4 }}>Recent</Text>
    </View>
  );

  return (
    <SectionList
      sections={[{ title: "Recent", data: history }]}
      keyExtractor={(item) => item.id}
      renderSectionHeader={() => null}
      renderItem={({ item }: ListRenderItemInfo<HistoryRow>) => (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.border,
            backgroundColor: t.colors.card,
          }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>
            {item.action.toUpperCase()} • {item.epc}
          </Text>
          <Text style={{ color: t.colors.muted }}>
            {new Date(item.ts).toLocaleTimeString()} {item.itemId ? `• ${item.itemId}` : ""}
          </Text>
          {item.err ? <Text style={{ color: t.colors.danger }}>{item.err}</Text> : null}
        </View>
      )}
      ListHeaderComponent={Header}
      ListEmptyComponent={
        <Text style={{ color: t.colors.muted, paddingHorizontal: 16, paddingBottom: 20 }}>
          No scans yet. Try Receive to test idempotency.
        </Text>
      }
      stickySectionHeadersEnabled={false}
      style={{ backgroundColor: t.colors.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
    />
  );
}

function Button({
  title,
  onPress,
  disabled,
  theme,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        opacity: disabled ? 0.6 : 1,
        marginRight: 8,
      }}
    >
      <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}
