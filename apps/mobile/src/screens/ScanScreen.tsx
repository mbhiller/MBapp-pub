import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { getObject } from "../api/client";
import { useColors } from "../features/_shared/useColors";

type Props = NativeStackScreenProps<RootStackParamList, "Scan">;

type QrParsed = {
  t?: "mbapp/object-v1";
  id?: string;
  type?: "product" | "inventory" | "event" | "registration" | "client" | "resource";
  intent?: "navigate" | "attach-epc";
  attachTo?: { type: string; id: string };
};

function tryParse(text: string): QrParsed | null {
  try {
    const j = JSON.parse(text);
    return j && typeof j === "object" ? (j as QrParsed) : null;
  } catch {
    return null;
  }
}

export default function ScanScreen({ navigation, route }: Props) {
  const t = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

  const routeTo = useCallback(
    (type: string, id: string) => {
      switch (type) {
        case "product":       navigation.navigate("ProductDetail", { id, mode: "edit" }); return;
        case "inventory":     navigation.navigate("InventoryDetail", { id, mode: "edit" }); return;
        case "event":         navigation.navigate("EventDetail", { id, mode: "edit" }); return;
        case "registration":  navigation.navigate("RegistrationDetail", { id }); return;
        case "client":        navigation.navigate("ClientDetail", { id, mode: "edit" }); return;
        case "resource":      navigation.navigate("ResourceDetail", { id, mode: "edit" }); return;
        default:
          Alert.alert("Unsupported type", `Type "${type}" is not routed yet.`);
      }
    },
    [navigation]
  );

  const handleAttachEpc = useCallback((payload: QrParsed) => {
    Alert.alert("Attach EPC (coming soon)", `AttachTo: ${JSON.stringify(payload.attachTo)}`);
  }, []);

  const onBarcodeScanned = useCallback(
    async (scan: { data: string }) => {
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

        // Preferred exact payload
        if (parsed.t === "mbapp/object-v1" && parsed.type && parsed.id) {
          routeTo(parsed.type, parsed.id);
          return;
        }

        // Fallback heuristics: try common types by id
        if (parsed.id) {
          const candidates = ["product", "event", "client", "resource"] as const;
          for (const ty of candidates) {
            try {
              await getObject(ty, parsed.id);
              routeTo(ty, parsed.id);
              return;
            } catch {
              // keep trying
            }
          }
        }

        Alert.alert("Not recognized", "Couldn’t resolve a known object from the scan.");
      } finally {
        setBusy(false);
        setTimeout(() => setScanning(true), 600);
      }
    },
    [scanning, busy, route.params?.intent, routeTo, handleAttachEpc]
  );

  if (!permission) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: t.colors.text, textAlign: "center" }}>
          Camera access is required to scan codes.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {!scanning && (
        <View
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 12,
            zIndex: 10,
            alignItems: "center",
          }}
        >
          {busy ? <ActivityIndicator /> : <Text style={{ color: t.colors.muted }}>Re-arming…</Text>}
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
