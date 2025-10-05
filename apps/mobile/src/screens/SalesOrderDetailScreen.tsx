import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { components } from "../api/generated-types";
import type { RootStackParamList } from "../navigation/types";
import { createObject, getObject, updateObject } from "../api/client";

type SalesOrder = components["schemas"]["SalesOrder"];
type Route = RouteProp<RootStackParamList, "SalesOrderDetail">;

const STATUS_VALUES = ["draft","submitted","committed","partiallyFulfilled","fulfilled","cancelled","closed"] as const;

export default function SalesOrderDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const id   = params?.id;
  const mode = params?.mode as "new" | "edit" | undefined;
  const isNew = mode === "new" || !id;
  const initial = (params?.initial ?? {}) as Partial<SalesOrder>;
  const t = useColors();

  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  // form state
  const [customerName, setCustomerName] = React.useState(String((initial as any)?.customerName ?? ""));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "draft"));
  const [notes, setNotes]   = React.useState(String((initial as any)?.notes ?? ""));

  // Load existing only (never load when new)
  const load = React.useCallback(async () => {
    if (isNew || !id) return;
    setLoading(true);
    try {
      const so = await getObject<SalesOrder>("salesOrder", String(id));
      setCustomerName((v) => v || String((so as any)?.customerName ?? ""));
      setStatus((v) => v || String((so as any)?.status ?? "draft"));
      setNotes((v) => v || String((so as any)?.notes ?? ""));
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load sales order");
    } finally {
      setLoading(false);
    }
  }, [isNew, id]);

  React.useEffect(() => { load(); }, [load]);

  async function onCreateDraft() {
    if (!customerName.trim()) { Alert.alert("Customer name is required"); return; }
    setSaving(true);
    try {
      await createObject<SalesOrder>("salesOrder", {
        type: "salesOrder",
        customerName: customerName.trim(),
        status: "draft",
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        // lines can be added later from a lines UI if/when you add it
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
    if (!customerName.trim()) { Alert.alert("Customer name is required"); return; }
    setSaving(true);
    try {
      await updateObject<SalesOrder>("salesOrder", String(id), {
        customerName: customerName.trim(),
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
        <Field label="Customer *" value={customerName} onChangeText={setCustomerName} />
        {!isNew && (
          <>
            <Label text="Status" />
            <PillGroup options={STATUS_VALUES as unknown as string[]} value={status} onChange={setStatus} />
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
