import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Scan">;

// Parsed payload shape (intentionally loose to avoid TS errors)
type QrParsed = {
  t?: string; // e.g. "mbapp/object-v1" | "mbapp/po-v1" | etc.
  id?: string;
  type?: string;
  href?: string;
  epc?: string; // allow EPC text as parsed fallback
};

function tryParse(text: string): QrParsed | null {
  try {
    const obj = JSON.parse(text);
    return typeof obj === "object" && obj ? (obj as QrParsed) : null;
  } catch {
    return null;
  }
}

export default function ScanScreen({ navigation, route }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

  const handleScan = useCallback(
    async (result: { data: string }) => {
      if (!scanning || busy) return;
      setScanning(false);
      setBusy(true);

      const text = result?.data ?? "";
      const parsed = tryParse(text);
      const intent = route.params?.intent ?? "navigate";

      try {
        // Minimal, safe intent handling
        if (parsed?.t === "mbapp/object-v1" && parsed.id && parsed.type) {
          if (intent === "attach-epc" && route.params?.attachTo) {
            // In a later slice, call API to set tags.rfidEpc etc.
            Alert.alert("Attach EPC", "Simulated attach complete.");
            navigation.goBack();
          } else {
            navigation.replace("ObjectDetail", {
              id: parsed.id,
              type: parsed.type,
            });
          }
          return;
        }

        // Fallback: treat as EPC/text and just alert for now
        const epc = parsed?.epc ?? text;
        Alert.alert("Scanned", epc.slice(0, 140));
        navigation.goBack();
      } finally {
        setBusy(false);
        setTimeout(() => setScanning(true), 250);
      }
    },
    [busy, navigation, route.params, scanning]
  );

  if (!permission?.granted) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text>Camera permission is required.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {busy && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            backgroundColor: "#00000020",
            zIndex: 1,
          }}
        >
          <ActivityIndicator />
        </View>
      )}
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "ean8", "upc_a", "upc_e", "pdf417"] }}
        onBarcodeScanned={({ data }) => handleScan({ data })}
      />
      <View style={{ padding: 12 }}>
        <Text>
          Intent: {route.params?.intent ?? "navigate"}
        </Text>
      </View>
    </View>
  );
}
