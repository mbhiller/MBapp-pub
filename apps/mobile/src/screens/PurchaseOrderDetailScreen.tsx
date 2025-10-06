import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { components } from "../api/generated-types";
import type { RootStackParamList } from "../navigation/types";
import { createObject, getObject, updateObject } from "../api/client";

type PurchaseOrder = components["schemas"]["PurchaseOrder"];
type Route = RouteProp<RootStackParamList, "PurchaseOrderDetail">;

const STATUS_VALUES = ["draft","submitted","approved","partiallyReceived","received","cancelled","closed"] as const;

export default function PurchaseOrderDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const id   = params?.id;
  const mode = params?.mode as "new" | "edit" | undefined;
  const isNew = mode === "new" || !id;
  const initial = (params?.initial ?? {}) as Partial<PurchaseOrder>;
  const t = useColors();

  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  // form state
  const [vendorName, setVendorName] = React.useState(String((initial as any)?.vendorName ?? ""));
  const [status, setStatus]         = React.useState<string>(String((initial as any)?.status ?? "draft"));
  const [notes, setNotes]           = React.useState(String((initial as any)?.notes ?? ""));

  // track if user changed status this session
  const statusTouched = React.useRef(false);

  // Load existing only
  const load = React.useCallback(async () => {
    if (isNew || !id) return;
    setLoading(true);
    try {
      const po = await getObject<PurchaseOrder>("purchaseOrder", String(id));
      setVendorName((v) => v || String((po as any)?.vendorName ?? ""));
      setNotes((v) => v || String((po as any)?.notes ?? ""));

      // hydrate status from server unless user touched locally this session
      const serverStatus = String((po as any)?.status ?? "draft");
      if (!statusTouched.current) setStatus(serverStatus);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load purchase order");
    } finally {
      setLoading(false);
    }
  }, [isNew, id]);

  React.useEffect(() => { load(); }, [load]);

  async function onCreateDraft() {
    if (!vendorName.trim()) { Alert.alert("Vendor name is required"); return; }
    setSaving(true);
    try {
      await createObject<PurchaseOrder>("purchaseOrder", {
        type: "purchaseOrder",
        vendorName: vendorName.trim(),
        status: "draft",
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      } as any);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to create draft");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveEdits() {
    if (!id) return;
    if (!vendorName.trim()) { Alert.alert("Vendor name is required"); return; }
    setSaving(true);
    try {
      await updateObject<PurchaseOrder>("purchaseOrder", String(id), {
        vendorName: vendorName.trim(),
        status,
        ...(notes.trim() ? { notes: notes.trim() } : { notes: undefined }),
      } as any);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        <Field label="Vendor *" value={vendorName} onChangeText={setVendorName} />
        {!isNew && (
          <>
            <Label text="Status" />
            <PillGroup
              options={STATUS_VALUES as unknown as string[]}
              value={status}
              onChange={(v) => { statusTouched.current = true; setStatus(v); }}
            />
          </>
        )}
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable
          onPress={isNew ? onCreateDraft : onSaveEdits}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {saving ? (isNew ? "Creating…" : "Saving…") : (isNew ? "Create Draft" : "Save")}
          </Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}
function Field({ label, value, onChangeText, multiline, keyboardType }:{
  label: string; value?: any; onChangeText: (v: any) => void; multiline?: boolean; keyboardType?: any;
}) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ marginBottom: 6, color: t.colors.muted }}>{label}</Text>
      <TextInput
        value={String(value ?? "")}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: t.colors.bg, color: t.colors.text,
          borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12,
          minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}
function PillGroup({ options, value, onChange }:{ options: string[]; value?: string; onChange: (v: string) => void; }) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.primary : t.colors.card, marginRight: 8, marginBottom: 8,
          }}>
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
