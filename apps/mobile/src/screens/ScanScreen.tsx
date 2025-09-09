// apps/mobile/src/screens/ScanScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Button, ActivityIndicator, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { getObject, updateObject } from "../api/client";
import { toast } from "../ui/Toast";
import { toastFromError } from "../lib/errors";
import { parseMbappQr } from "../lib/qr";

type AttachTarget = { id: string; type: string };

export default function ScanScreen({ route, navigation }: any) {
  const attachTo: AttachTarget | undefined = route?.params?.attachTo;
  const [permission, requestPermission] = useCameraPermissions();
  const [epc, setEpc] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission, requestPermission]);

  const normalize = (raw: string): string => {
    if (!raw) return "";
    const t = raw.trim();
    try {
      if (/^https?:\/\//i.test(t)) {
        const u = new URL(t);
        const last = u.pathname.split("/").filter(Boolean).pop() || u.searchParams.get("epc") || t;
        return String(last).toUpperCase();
      }
    } catch {}
    return t.toUpperCase();
  };

  const handleAttach = useCallback(
    async (value: string) => {
      const trimmed = normalize(value);
      if (!trimmed) { toast("No EPC to attach"); return; }
      if (!attachTo) { setEpc(trimmed); toast("Scanned EPC captured"); return; }

      setBusy(true);
      try {
        const cur = await getObject(attachTo.type, attachTo.id);
        const mergedTags = { ...(cur?.tags || {}), rfidEpc: trimmed };
        const next = await updateObject(attachTo.type, attachTo.id, { tags: mergedTags });
        toast("EPC attached");
        navigation.replace("ObjectDetail", { id: attachTo.id, type: attachTo.type, obj: { ...next, type: attachTo.type } });
      } catch (e: any) {
        toastFromError(e, "Attach failed");
      } finally {
        setBusy(false);
        lockedRef.current = false;
      }
    },
    [attachTo, navigation]
  );

  const onBarcodeScanned = useCallback(
    ({ data }: any) => {
      if (!data || lockedRef.current || busy) return;
      lockedRef.current = true;

      const mb = parseMbappQr(String(data));
      if (mb?.id && mb?.type) {
        // Pass both param shapes to be compatible with any ObjectDetail implementation
        navigation.navigate("ObjectDetail", { id: mb.id, type: mb.type, obj: { id: mb.id, type: mb.type } });
        return;
      }

      // Fallback: treat as EPC
      handleAttach(String(data));
    },
    [busy, handleAttach, navigation]
  );

  const needPermission = !permission || !permission.granted;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ padding: 12, backgroundColor: "#111" }}>
        <Text style={{ color: "#fff", fontWeight: "700" }}>
          {attachTo ? `Attach EPC → ${attachTo.type}/${attachTo.id}` : "Scan EPC or MBapp QR"}
        </Text>
        <Text style={{ color: "#ccc", marginTop: 4 }}>
          {attachTo
            ? "Scan a tag to attach to this object, or enter EPC manually."
            : "Scan an MBapp QR to open detail, or scan an EPC to capture/attach later."}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        {needPermission ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
            <Text style={{ color: "#fff", marginBottom: 12 }}>Camera permission is required</Text>
            <Button title="Grant permission" onPress={() => requestPermission()} />
          </View>
        ) : (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "upc_a", "upc_e"] } as any}
            onBarcodeScanned={onBarcodeScanned}
          />
        )}
      </View>

      <View style={{ backgroundColor: "#111", padding: 12 }}>
        <Text style={{ color: "#fff", marginBottom: 6 }}>Manual EPC</Text>
        <TextInput
          value={epc}
          onChangeText={setEpc}
          placeholder="RFID EPC (hex or text)"
          placeholderTextColor="#777"
          autoCapitalize="characters"
          autoCorrect={false}
          style={{
            backgroundColor: "#222",
            borderWidth: 1,
            borderColor: "#333",
            color: "#fff",
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
          }}
        />

        <View style={{ flexDirection: "row", gap: 12, marginTop: 10, alignItems: "center" }}>
          <Button title={busy ? "Attaching…" : attachTo ? "Attach EPC" : "Save EPC"} onPress={() => handleAttach(epc)} disabled={busy || !epc.trim()} />
          {busy && <ActivityIndicator color="#fff" />}
          <Pressable onPress={() => navigation.goBack()} style={{ marginLeft: "auto", padding: 8 }}>
            <Text style={{ color: "#9cf", fontWeight: "600" }}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
