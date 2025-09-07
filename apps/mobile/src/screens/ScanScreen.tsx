import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Alert, ActivityIndicator, TouchableOpacity } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { createObject, getObject } from "../api/client";
import { useNavigation } from "@react-navigation/native";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);
  const nav = useNavigation<any>();

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain !== false) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const extractData = useCallback((payload: any): string | undefined => {
    if (payload?.data) return String(payload.data);
    const arr = payload?.barcodes;
    if (Array.isArray(arr) && arr[0]?.data) return String(arr[0].data);
    return undefined;
  }, []);

  const handleParsed = useCallback(async (text: string) => {
    // Accept JSON or plain ID
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }

    const type = parsed?.type || "horse";
    const id   = parsed?.id;

    setBusy(true);
    try {
      let obj: any;
      if (id) {
        const res = await getObject(type, id);
        obj = { type, ...(res || {}) }; // ensure type present even if server returns only { id }
      } else {
        const body: any = {};
        if (parsed && typeof parsed === "object") {
          body.data = parsed.data ?? parsed; // allow raw payload objects
          if (parsed.integrations) body.integrations = parsed.integrations;
        } else {
          body.data = { raw: String(text) }; // fallback
        }
        const res = await createObject(type, body);
        obj = { type, ...(res || {}) };
        if (!obj.data && body.data) obj.data = body.data; // UI stays informative
        if (!obj.integrations && body.integrations) obj.integrations = body.integrations;
      }
      nav.navigate("ObjectDetail", { obj });
    } catch (e: any) {
      Alert.alert("Scan Error", e?.response?.data?.error || e?.message || "Failed to process scan");
      setScanning(true);
    } finally {
      setBusy(false);
    }
  }, [nav]);

  const onBarcodeScanned = useCallback((result: any) => {
    if (!scanning || busy) return;
    const text = extractData(result);
    if (!text) return;
    setScanning(false);
    handleParsed(text);
  }, [scanning, busy, extractData, handleParsed]);

  if (!permission) {
    return <View style={{flex:1,alignItems:"center",justifyContent:"center"}}><Text>Checking camera permission…</Text></View>;
  }
  if (!permission.granted) {
    return (
      <View style={{flex:1,alignItems:"center",justifyContent:"center", padding: 16}}>
        <Text style={{textAlign:"center", marginBottom: 12}}>We need camera access to scan QR codes.</Text>
        <TouchableOpacity onPress={requestPermission} style={{ padding: 12, backgroundColor: "#eee", borderRadius: 8 }}>
          <Text>Grant Camera Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {busy && (
          <View style={{ position:"absolute", top:0,left:0,right:0,bottom:0, zIndex:2, alignItems:"center", justifyContent:"center", backgroundColor:"rgba(0,0,0,0.25)" }}>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 8, color: "white" }}>Processing…</Text>
          </View>
        )}
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
        />
      </View>
      {!scanning && !busy && (
        <TouchableOpacity onPress={() => setScanning(true)} style={{ padding: 14, backgroundColor: "#eee" }}>
          <Text style={{ textAlign: "center", fontWeight: "600" }}>Scan Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
