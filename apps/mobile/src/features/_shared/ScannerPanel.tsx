// apps/mobile/src/features/_shared/ScannerPanel.tsx
import * as React from "react";
import { View, Text, Pressable, TextInput, Vibration, KeyboardAvoidingView, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { useColors } from "./useColors";
import { useToast } from "./Toast";

export function ScannerPanel({
  value,
  onChange,
  onSubmit,
  onManualInputFocus,
  onScan,
  autoOpenCamera,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: (val: string) => void;
  onManualInputFocus?: () => void;
  onScan?: (val: string) => void;
  autoOpenCamera?: boolean;
}) {
  const t = useColors();
  const toast = useToast();

  const [showCamera, setShowCamera] = React.useState(autoOpenCamera || false);
  const [permission, requestPermission] = useCameraPermissions();
  const lastRef = React.useRef<{ data?: string; at?: number }>({});

  const permissionState = React.useMemo(() => {
    if (!permission) return "unknown" as const;
    if (permission.granted) return "granted" as const;
    if (permission.canAskAgain) return "prompt" as const;
    return "denied" as const;
  }, [permission]);

  React.useEffect(() => {
    if (autoOpenCamera && !showCamera) {
      setShowCamera(true);
    }
  }, [autoOpenCamera]);

  React.useEffect(() => {
    if (showCamera && !permission?.granted) requestPermission().catch(() => {});
  }, [showCamera, permission?.granted, requestPermission]);

  const onBarcodeScanned = React.useCallback(
    ({ data }: { data: string }) => {
      const d = String(data || "").trim();
      if (!d) return;
      const now = Date.now();
      const last = lastRef.current;
      if (last.data === d && last.at && now - last.at < 1200) return; // debounce
      lastRef.current = { data: d, at: now };
      onChange(d);
      if (onScan) onScan(d);
      Vibration.vibrate(10);
      toast("Captured", "success");
    },
    [onChange, onScan, toast]
  );

  const handleSubmit = React.useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (onSubmit) {
      onSubmit(trimmed);
    } else {
      onChange(trimmed);
    }
  }, [onChange, onSubmit, value]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={{ paddingBottom: 24 }}>
        {/* Manual entry */}
        <View style={{ gap: 6 }}>
          <Text style={{ fontWeight: "600", color: t.colors.text }}>Manual entry</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="Type or scan Item ID / EPC"
              placeholderTextColor={t.colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={handleSubmit}
              returnKeyType="done"
                            onFocus={onManualInputFocus}
              style={{
                flex: 1,
                backgroundColor: t.colors.bg,
                color: t.colors.text,
                borderColor: t.colors.border,
                borderWidth: 1,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <Pressable
              onPress={handleSubmit}
              hitSlop={10}
              style={{
                marginLeft: 8,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.colors.border,
                backgroundColor: t.colors.card,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "700" }}>Add</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowCamera((v) => !v)}
              hitSlop={10}
              style={{
                marginLeft: 8, // ← spacing to match search button
                width: 44,
                height: 44,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.colors.border,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.colors.card,
              }}
            >
              <Feather name={showCamera ? "camera-off" : "camera"} size={18} color={t.colors.text} />
            </Pressable>
          </View>
          <Text style={{ color: t.colors.muted, fontSize: 12 }}>
            {permissionState === "unknown" && "Camera status: loading… Manual entry is available."}
            {permissionState === "prompt" && "Camera access not granted yet. Use manual entry or enable camera."}
            {permissionState === "denied" && "Camera access denied. Use manual entry; enable permission to scan."}
            {permissionState === "granted" && "Camera enabled. Manual entry also available."}
          </Text>
        </View>

        {showCamera ? (
          permissionState === "granted" ? (
            <View style={{ height: 240, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: t.colors.border, marginTop: 10 }}>
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
          ) : permissionState === "denied" ? (
            <View style={{ padding: 8 }}>
              <Text style={{ color: t.colors.muted }}>Camera permission required.</Text>
              <Pressable
                onPress={() => requestPermission()}
                style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}
              >
                <Text style={{ color: t.colors.text }}>Grant Permission</Text>
              </Pressable>
            </View>
          ) : permissionState === "prompt" ? (
            <View style={{ padding: 8 }}>
              <Text style={{ color: t.colors.muted }}>Requesting camera permission…</Text>
              <Pressable
                onPress={() => requestPermission()}
                style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}
              >
                <Text style={{ color: t.colors.text }}>Grant Permission</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ padding: 8 }}>
              <Text style={{ color: t.colors.muted }}>Loading camera…</Text>
            </View>
          )
        ) : null}

        {/* Spacer to keep input visible above keyboard */}
        <View style={{ height: 12 }} />
      </View>
    </KeyboardAvoidingView>
  );
}
