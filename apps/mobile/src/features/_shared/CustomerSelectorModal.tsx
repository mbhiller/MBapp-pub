// apps/mobile/src/features/_shared/CustomerSelectorModal.tsx
import * as React from "react";
import {
  View, Text, Pressable, ActivityIndicator, Modal, Platform, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "../_shared/useColors";
import { getObject } from "../../api/client";
import { ScannerPanel } from "../_shared/ScannerPanel";
import { CustomerPicker } from "./fields";

type CustomerRecord = {
  id: string;
  type: string;
  name?: string;
  email?: string;
  phone?: string;
  altPhone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  notes?: string;
};

export type CustomerSnapshot = {
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAltPhone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  customerNotes?: string;
};

function normalizeSnapshot(x: CustomerRecord): CustomerSnapshot {
  return {
    customerId: x.id,
    customerName: x.name,
    customerEmail: x.email,
    customerPhone: x.phone,
    customerAltPhone: x.altPhone,
    billingAddress: x.billingAddress,
    shippingAddress: x.shippingAddress,
    customerNotes: x.notes,
  };
}

export function CustomerSelectorModal({
  visible,
  onClose,
  onSave,
  title = "Select Customer",
  searchTypes = ["client", "customer", "vendor", "employee"],
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (snap: CustomerSnapshot) => void;
  title?: string;
  searchTypes?: string[];
}) {
  const t = useColors();

  const [selected, setSelected] = React.useState<CustomerRecord | null>(null);
  const [scanValue, setScanValue] = React.useState("");
  const [resolving, setResolving] = React.useState(false);

  React.useEffect(() => {
    if (!visible) {
      setSelected(null);
      setScanValue("");
      setResolving(false);
    }
  }, [visible]);

  async function resolvePickedCustomer(partial: { id: string; label: string; type?: string }) {
    setResolving(true);
    try {
      const tyList = partial.type ? [partial.type] : searchTypes;
      for (const ty of tyList) {
        try {
          const rec = await getObject<CustomerRecord>(ty, partial.id);
          if (rec?.id) { setSelected({ ...rec, type: ty }); return; }
        } catch {}
      }
      // Fallback to at least keep id/label
      setSelected({ id: partial.id, type: partial.type || "customer", name: partial.label });
    } finally {
      setResolving(false);
    }
  }

  async function saveChoice() {
    if (selected?.id) { onSave(normalizeSnapshot(selected)); return; }

    // Try to resolve by typed/scanned text
    const idOrCode = scanValue.trim();
    if (!idOrCode) return;
    for (const ty of searchTypes) {
      try {
        const rec = await getObject<CustomerRecord>(ty, idOrCode);
        if (rec?.id) { onSave(normalizeSnapshot({ ...rec, type: ty })); return; }
      } catch {}
    }
    onClose();
  }

  const canSave = Boolean(selected?.id || scanValue.trim());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView
        style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 16,
        }}
        edges={["top", "bottom"]}
      >
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: "padding", android: undefined })}
          style={{ width: "96%", maxWidth: 640 }}
        >
          <View
            style={{
              backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, overflow: "hidden",
            }}
          >
            {/* Header */}
            <View
              style={{
                height: 48, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                borderBottomWidth: 1, borderBottomColor: t.colors.border,
              }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "700" as any }}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
                <Feather name="x" size={20} color={t.colors.text} />
              </Pressable>
            </View>

            {/* Body */}
            <View style={{ padding: 12, gap: 12 }}>
              {/* Row 1: Scanner */}
              <ScannerPanel value={scanValue} onChange={setScanValue} />

              {/* Row 2: Autocomplete */}
              <View>
                <CustomerPicker
                  placeholder="Search customers…"
                  initialText=""
                  onSelect={(res) => resolvePickedCustomer(res)}
                />
                {resolving ? (
                  <View style={{ paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator />
                    <Text style={{ color: t.colors.textMuted }}>Loading details…</Text>
                  </View>
                ) : selected?.name ? (
                  <Text style={{ color: t.colors.textMuted, marginTop: 6 }}>
                    Selected: <Text style={{ color: t.colors.text, fontWeight: "600" as any }}>{selected.name}</Text>
                    {selected.type ? <Text style={{ color: t.colors.textMuted }}> · {selected.type}</Text> : null}
                  </Text>
                ) : null}
              </View>

              {/* Footer */}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Pressable
                  onPress={onClose}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 10,
                    borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card,
                  }}
                >
                  <Text style={{ color: t.colors.text }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveChoice}
                  disabled={!canSave}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
                    backgroundColor: t.colors.primary, opacity: canSave ? 1 : 0.5,
                  }}
                  accessibilityState={{ disabled: !canSave }}
                >
                  <Text style={{ color: (t.colors as any).buttonText ?? "#fff", fontWeight: "700" as any }}>
                    Save
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
