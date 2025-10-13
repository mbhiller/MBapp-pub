// apps/mobile/src/features/_shared/CustomerSelectorModal.tsx
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "../_shared/useColors";
import { CustomerPicker } from "../_shared/fields";
import { getObject } from "../../api/client";

export type CustomerSnapshot = {
  customerId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAltPhone?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  customerNotes?: string | null;
};

// ---- helpers to normalize cross-type fields ----
function labelForParty(rec: any, fallback?: string) {
  return (
    rec?.name ??
    rec?.displayName ??
    rec?.legalName ??
    rec?.companyName ??
    rec?.fullName ??
    fallback ??
    rec?.id
  );
}
function pickStr(...vals: Array<any>): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

export function CustomerSelectorModal({
  visible,
  onClose,
  onSave,
  title = "Select Customer",
  initialCustomer, // optional pre-seed { id, label }
  candidateTypes,  // e.g. ["employee","vendor","client","organization","contact","person"]
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (snap: CustomerSnapshot) => void;
  title?: string;
  initialCustomer?: { id: string; label?: string } | null;
  candidateTypes?: string[];
}) {
  const t = useColors();
  const [picked, setPicked] = React.useState<{ id: string; label?: string } | null>(initialCustomer ?? null);
  const [initialText, setInitialText] = React.useState<string>(initialCustomer?.label ?? "");
  const [busy, setBusy] = React.useState(false);

  // default set of party collections to try when hydrating the record by id
  const TYPES_DEFAULT = React.useMemo(
    () => ["employee", "vendor", "client", "organization", "contact", "person", "customer", "patient"],
    []
  );
  const typesToTry = candidateTypes && candidateTypes.length ? candidateTypes : TYPES_DEFAULT;

  React.useEffect(() => {
  if (visible) {
    setPicked(initialCustomer ?? null);
    setInitialText(initialCustomer?.label ?? "");
  } else {
    setBusy(false);
  }
  // Track id/label independently to avoid stale seeds
}, [visible, initialCustomer?.id, initialCustomer?.label]);

  async function save() {
    if (!picked?.id || busy) return;
    setBusy(true);
    try {
      // Try multiple collections to hydrate details for the snapshot
      let c: any = null;
      for (const ty of typesToTry) {
        try {
          const rec = await getObject<any>(ty, picked.id);
          if (rec?.id) {
            c = rec;
            break;
          }
        } catch {
          // ignore per-type failures; we'll try the next one
        }
      }

      const snap: CustomerSnapshot = {
        customerId: picked.id,
        customerName: labelForParty(c, picked.label) ?? null,
        customerEmail: pickStr(c?.email, c?.primaryEmail, c?.workEmail) ?? null,
        customerPhone: pickStr(c?.phone, c?.primaryPhone, c?.workPhone, c?.mobile) ?? null,
        customerAltPhone: pickStr(c?.altPhone, c?.secondaryPhone) ?? null,
        billingAddress: pickStr(c?.billingAddress, c?.address, c?.mailingAddress) ?? null,
        shippingAddress: pickStr(c?.shippingAddress, c?.deliveryAddress) ?? null,
        customerNotes: pickStr(c?.notes, c?.memo) ?? null,
      };

      onSave(snap);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
        edges={["top", "bottom"]}
      >
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: "padding", android: undefined })}
          style={{ width: "96%", maxWidth: 640 }}
        >
          <View
            style={{
              backgroundColor: t.colors.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.colors.border,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <View
              style={{
                height: 48,
                paddingHorizontal: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottomWidth: 1,
                borderBottomColor: t.colors.border,
              }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "700" as const }}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
                <Feather name="x" size={20} color={t.colors.text} />
              </Pressable>
            </View>

            {/* Body */}
            <View style={{ padding: 12, gap: 12 }}>
              <CustomerPicker
                placeholder="Search customers…"
                initialText={initialText}
                onSelect={(r) => {
                  setPicked({ id: r.id, label: r.label });
                  Keyboard.dismiss();
                }}
              />
            </View>

            {/* Footer */}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, padding: 12 }}>
              <Pressable
                onPress={onClose}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  backgroundColor: t.colors.card,
                }}
              >
                <Text style={{ color: t.colors.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={!picked || busy}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: t.colors.primary,
                  opacity: !picked || busy ? 0.6 : 1,
                }}
              >
                {busy ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={{ color: (t.colors as any).buttonText ?? "#fff", fontWeight: "700" as const }}>
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
