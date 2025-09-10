// apps/mobile/src/screens/ScanScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Button, ActivityIndicator, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { getObject, updateObject } from "../api/client";
import { toast } from "../ui/Toast";
import { toastFromError } from "../lib/errors";
import { parseMbappQr } from "../lib/qr";
import { Screen } from "../ui/Screen";
import { Section } from "../ui/Section";
import { NonProdBadge } from "../ui/NonProdBadge";
import { useTheme } from "../ui/ThemeProvider";

type AttachTarget = { id: string; type: string };

export default function ScanScreen({ route, navigation }: any) {
  const t = useTheme();
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
    const txt = raw.trim();
    try {
      if (/^https?:\/\//i.test(txt)) {
        const u = new URL(txt);
        const last = u.pathname.split("/").filter(Boolean).pop() || u.searchParams.get("epc") || txt;
        return String(last).toUpperCase();
      }
    } catch {}
    return txt.toUpperCase();
  };

  const handleAttach = useCallback(
    async (value: string) => {
      const trimmed = normalize(value);
      if (!trimmed) {
        toast("No EPC to attach");
        return;
      }
      if (!attachTo) {
        setEpc(trimmed);
        toast("Scanned EPC captured");
        return;
      }

      setBusy(true);
      try {
        const cur = await getObject(attachTo.type, attachTo.id);
        const mergedTags = { ...(cur?.tags || {}), rfidEpc: trimmed };
        const next = await updateObject(attachTo.type, attachTo.id, { tags: mergedTags });

        toast("EPC attached");
        navigation.replace("ObjectDetail", {
          id: attachTo.id,
          type: attachTo.type,
          obj: { ...next, type: attachTo.type },
        });
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
        navigation.navigate("ObjectDetail", { id: mb.id, type: mb.type, obj: { id: mb.id, type: mb.type } });
        return;
      }

      handleAttach(String(data));
    },
    [busy, handleAttach, navigation]
  );

  const needPermission = !permission || !permission.granted;

  return (
    <Screen title="Scan" scroll={false}>
      <View style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
        <NonProdBadge />
      </View>

      <Section label={attachTo ? `Attach EPC → ${attachTo.type}/${attachTo.id}` : "Scanner"} style={{ padding: 0, overflow: "hidden" }}>
        {needPermission ? (
          <View style={{ alignItems: "center", justifyContent: "center", padding: 16 }}>
            <Text style={{ color: t.text, marginBottom: 12 }}>Camera permission is required</Text>
            <Button title="Grant permission" onPress={() => requestPermission()} />
          </View>
        ) : (
          <View style={{ height: 360, backgroundColor: "#000" }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "upc_a", "upc_e"] } as any}
              onBarcodeScanned={onBarcodeScanned}
            />
          </View>
        )}
      </Section>

      <Section label="Manual EPC">
        <TextInput
          value={epc}
          onChangeText={setEpc}
          placeholder="RFID EPC (hex or text)"
          placeholderTextColor={t.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          style={{
            backgroundColor: "#f2f2f2",
            borderColor: "#e5e5e5",
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: t.text,
          }}
        />

        <View style={{ flexDirection: "row", gap: 12, marginTop: 10, alignItems: "center" }}>
          <Button
            title={busy ? "Attaching…" : attachTo ? "Attach EPC" : "Save EPC"}
            onPress={() => handleAttach(epc)}
            disabled={busy || !epc.trim()}
          />
          {busy && <ActivityIndicator />}
          <Pressable onPress={() => navigation.goBack()} style={{ marginLeft: "auto", padding: 8 }}>
            <Text style={{ color: t.primary, fontWeight: "700" }}>Done</Text>
          </Pressable>
        </View>
      </Section>
    </Screen>
  );
}
