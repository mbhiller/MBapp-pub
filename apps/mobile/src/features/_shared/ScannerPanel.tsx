// apps/mobile/src/features/_shared/ScannerPanel.tsx
import * as React from "react";
import { View, Text, Pressable, TextInput, Vibration } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { useColors } from "./useColors";
import { useToast } from "./Toast";

export function ScannerPanel({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useColors();
  const toast = useToast();

  const [showCamera, setShowCamera] = React.useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const lastRef = React.useRef<{ data?: string; at?: number }>({});

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
      Vibration.vibrate(10);
      toast("Captured", "success");
    },
    [onChange, toast]
  );

  return (
    <View>
      {/* Input + camera toggle with 8px gap (matches search row spacing) */}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Type or scan Item ID / EPC"
          placeholderTextColor={t.colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
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

      {showCamera ? (
        permission?.granted ? (
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
        ) : permission?.granted === false ? (
          <View style={{ padding: 8 }}>
            <Text style={{ color: t.colors.muted }}>Camera permission required.</Text>
            <Pressable
              onPress={() => requestPermission()}
              style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}
            >
              <Text style={{ color: t.colors.text }}>Grant Permission</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ padding: 8 }}>
            <Text style={{ color: t.colors.muted }}>Requesting camera permission…</Text>
          </View>
        )
      ) : null}
    </View>
  );
}
