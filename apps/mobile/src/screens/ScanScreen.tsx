import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { getObject } from "../api/client";

type Props = NativeStackScreenProps<RootStackParamList, "Scan">;

type QrParsed = {
  t?: string;          // "mbapp/object-v1"
  id?: string;
  type?: string;       // product | inventory | event | registration
  intent?: "navigate" | "attach-epc";
  attachTo?: { type: string; id: string };
};

function tryParse(text: string): QrParsed | null {
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") return j as QrParsed;
    return null;
  } catch { return null; }
}

export default function ScanScreen({ navigation, route }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

  const routeTo = useCallback((type: string, id: string) => {
    switch (type) {
      case "product":
        navigation.navigate("ProductDetail", { id, mode: "edit" });
        return;
      case "inventory":
        navigation.navigate("InventoryDetail", { id, mode: "edit" });
        return;
      case "event":
        navigation.navigate("EventDetail", { id, mode: "edit" });
        return;
      case "registration":
        navigation.navigate("RegistrationDetail", { id });
        return;
      default:
        Alert.alert("Unsupported type", `Type "${type}" is not routed yet.`);
    }
  }, [navigation]);

  const handleAttachEpc = useCallback((payload: QrParsed) => {
    Alert.alert(
      "Attach EPC (coming soon)",
      `Intent: attach-epc\nAttachTo: ${JSON.stringify(payload.attachTo)}`
    );
  }, []);

  const onBarcodeScanned = useCallback(async (scan: { data: string }) => {
    if (!scanning || busy) return;
    setScanning(false);
    setBusy(true);
    try {
      const text = scan.data?.trim();
      const parsed = tryParse(text) ?? ({ id: text } as QrParsed);
      const intent = parsed.intent ?? route.params?.intent ?? "navigate";

      if (intent === "attach-epc") {
        handleAttachEpc(parsed);
        return;
      }

      // Prefer explicit object payloads
      if (parsed.t === "mbapp/object-v1" && parsed.type && parsed.id) {
        routeTo(parsed.type, parsed.id);
        return;
      }

      // Fallback heuristics: try product, then inventory
      if (parsed.id) {
        try {
          await getObject("product", parsed.id);
          routeTo("product", parsed.id);
          return;
        } catch (_) { /* try inventory next */ }
        try {
          await getObject("inventory", parsed.id);
          routeTo("inventory", parsed.id);
          return;
        } catch (_) { /* no-op */ }
      }

      Alert.alert("Not recognized", "Couldn’t resolve a known object from the scan.");
    } finally {
      setBusy(false);
      // Re-arm the scanner a moment later so accidental double scans are avoided
      setTimeout(() => setScanning(true), 600);
    }
  }, [scanning, busy, route.params?.intent, routeTo, handleAttachEpc]);

  if (!permission) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text>Camera access is required to scan codes.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {!scanning && (
        <View style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 10, alignItems: "center" }}>
          {busy ? <ActivityIndicator /> : <Text>Re-arming scanner…</Text>}
        </View>
      )}
      <CameraView
        style={{ flex: 1 }}
        onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      />
    </View>
  );
}
