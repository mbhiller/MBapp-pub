import * as React from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Modal, Platform, KeyboardAvoidingView, Keyboard } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "../_shared/useColors";
import { SalesLinePicker } from "../_shared/fields";
import { ScannerPanel } from "../_shared/ScannerPanel";
import { resolveEpc } from "../_shared/epc";
import { getObject } from "../../api/client";

export type ItemSelection = { itemId: string; qty: number };

export function ItemSelectorModal({
  visible,
  onClose,
  onSave,
  title = "Select Item",
  initialQty = 1,
  initialItem,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (sel: ItemSelection) => void;
  title?: string;
  initialQty?: number;
  initialItem?: { id: string; label?: string; type?: string } | null;
}) {
  const t = useColors();

  const [picked, setPicked] = React.useState<{ id: string; label?: string } | null>(null);
  const [initialText, setInitialText] = React.useState<string>("");
  const [resolving, setResolving] = React.useState(false);

  const [qtyInput, setQtyInput] = React.useState<string>(String(initialQty ?? 1));
  const [scanValue, setScanValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!visible) {
      setPicked(null);
      setInitialText("");
      setQtyInput(String(initialQty ?? 1));
      setScanValue("");
      setResolving(false);
      setBusy(false);
      return;
    }
    setQtyInput(String(initialQty ?? 1));
    if (initialItem?.id) {
      if (initialItem.label) {
        setPicked({ id: initialItem.id, label: initialItem.label });
        setInitialText(initialItem.label);
      } else {
        (async () => {
          setResolving(true);
          try {
            const tryTypes = initialItem.type ? [initialItem.type] : ["product", "inventory"];
            let label = "";
            for (const ty of tryTypes) {
              try {
                const rec = await getObject<any>(ty, initialItem.id);
                if (rec?.id) { label = rec?.name ?? rec?.label ?? rec?.sku ?? rec?.code ?? rec.id; break; }
              } catch {}
            }
            setPicked({ id: initialItem.id, label: label || initialItem.id });
            setInitialText(label || initialItem.id);
          } finally {
            setResolving(false);
          }
        })();
      }
    } else {
      setPicked(null);
      setInitialText("");
    }
  }, [visible, initialItem, initialQty]);

  const canSave = Boolean((picked?.id || scanValue.trim()) && (qtyInput.trim().length > 0));

  function onPick(res: { id: string; label: string }) {
    setPicked({ id: res.id, label: res.label });
    setInitialText(res.label);
    Keyboard.dismiss();
  }
  function onQtyChange(text: string) {
    const digitsOnly = text.replace(/[^\d]/g, "");
    setQtyInput(digitsOnly);
  }
  function normalizeQty(): number {
    const n = parseInt(qtyInput, 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    return n;
  }

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      let itemId = picked?.id ?? scanValue.trim();
      if (!picked?.id && scanValue.trim()) {
        try {
          const res = await resolveEpc(scanValue.trim()).catch(() => null);
          if (res?.itemId) itemId = res.itemId;
        } catch {}
      }
      const qty = normalizeQty();
      if (!itemId || qty <= 0) return;
      onSave({ itemId, qty });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 16 }} edges={["top","bottom"]}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ width: "96%", maxWidth: 640 }}>
          <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, overflow: "hidden" }}>
            {/* Header */}
            <View style={{ height: 48, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
              <Text style={{ color: t.colors.text, fontWeight: "700" as const }}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
                <Feather name="x" size={20} color={t.colors.text} />
              </Pressable>
            </View>

            {/* Body */}
            <View style={{ padding: 12, gap: 12 }}>
              <ScannerPanel value={scanValue} onChange={setScanValue} />
              <SalesLinePicker placeholder="Search items…" initialText={initialText} onSelect={onPick} />
              {resolving ? <Text style={{ color: t.colors.textMuted }}>Loading item…</Text> : null}

              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: t.colors.text, width: 60 }}>Qty</Text>
                <TextInput
                  value={qtyInput}
                  onChangeText={onQtyChange}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  placeholder="Qty"
                  placeholderTextColor={t.colors.textMuted}
                  onSubmitEditing={save}
                  style={{
                    flex: 1, height: 44, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 10,
                    backgroundColor: (t.colors as any).inputBg ?? t.colors.card, color: t.colors.text,
                  }}
                />
              </View>

              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Pressable onPress={onClose} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}>
                  <Text style={{ color: t.colors.text }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={save} disabled={!canSave || busy} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: t.colors.primary, opacity: !canSave || busy ? 0.6 : 1 }}>
                  {busy ? <ActivityIndicator /> : <Text style={{ color: (t.colors as any).buttonText ?? "#fff", fontWeight: "700" as const }}>Save</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
