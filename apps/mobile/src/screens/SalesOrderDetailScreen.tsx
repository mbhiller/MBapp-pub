import * as React from "react";
import {
  View, Text, TextInput, Pressable, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { getObject, updateObject, createObject } from "../api/client";
import { ScannerPanel } from "../features/_shared/ScannerPanel";

type RootStackParamList = {
  SalesOrderDetail: { id?: string; mode?: "new" | "edit"; expandScanner?: boolean } | undefined;
};
type Route = RouteProp<RootStackParamList, "SalesOrderDetail">;

const STATUS_VALUES = [
  "draft",
  "submitted",
  "committed",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
  "closed",
] as const;

export default function SalesOrderDetailScreen() {
  const { params } = useRoute<Route>();
  const t = useColors();

  const [id, setId] = React.useState<string | undefined>(params?.id);
  const [customerName, setCustomerName] = React.useState("");
  const [status, setStatus] = React.useState("draft");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(Boolean(id));
  const [saving, setSaving] = React.useState(false);

  // Load SO when id exists
  React.useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const so = await getObject<any>("salesOrder", id);
        setCustomerName(String(so?.customerName ?? ""));
        setStatus(String(so?.status ?? "draft"));
        setNotes(String(so?.notes ?? ""));
        setLines(Array.isArray(so?.lines) ? so.lines : []);
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Failed to load sales order");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function onCreateDraft() {
    if (!customerName.trim()) return Alert.alert("Validation", "Customer name is required.");
    setSaving(true);
    try {
      const created = await createObject<any>("salesOrder", {
        type: "salesOrder",
        customerName: customerName.trim(),
        status: "draft",
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: [],
      });
      setId(String(created?.id));
      Alert.alert("Created", "Draft sales order created.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to create order");
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!id) return;
    if (!customerName.trim()) return Alert.alert("Validation", "Customer name is required.");
    setSaving(true);
    try {
      const updated = await updateObject<any>("salesOrder", id, {
        customerName: customerName.trim(),
        status,
        ...(notes.trim() ? { notes: notes.trim() } : { notes: undefined }),
      });
      setLines(Array.isArray(updated?.lines) ? updated.lines : lines);
      Alert.alert("Saved", "Sales order updated.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Scanner card AT TOP */}
      <ScannerPanel
        soId={id}
        initialCollapsed={!Boolean(params?.expandScanner)}
        defaultMode={id ? "add" : "receive"}
        // extraModes={[ ...optional module-specific actions... ]}
        onLinesChanged={(next) => setLines(next)}
      />
      {/* Info Card */}
      <View
        style={{
          backgroundColor: t.colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: 16,
        }}
      >
        <Field label="Customer *" value={customerName} onChangeText={setCustomerName} />
        {id ? (
          <>
            <Label text="Status" />
            <PillGroup
              options={STATUS_VALUES as unknown as string[]}
              value={status}
              onChange={setStatus}
            />
          </>
        ) : null}
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable
          onPress={id ? onSave : onCreateDraft}
          disabled={saving}
          style={{
            marginTop: 12,
            backgroundColor: t.colors.primary,
            padding: 14,
            borderRadius: 10,
            alignItems: "center",
            opacity: saving ? 0.7 : 1,
          }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" as const }}>
            {id ? (saving ? "Saving…" : "Save") : (saving ? "Creating…" : "Create Draft")}
          </Text>
        </Pressable>
      </View>

      {/* Lines */}
      <View
        style={{
          backgroundColor: t.colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: 16,
          marginBottom: 4,
        }}
      >
        <Label text="Lines" />
        {loading ? (
          <ActivityIndicator />
        ) : lines.length ? (
          lines.map((ln, idx) => (
            <View
              key={(ln as any).id ?? `${(ln as any).itemId}-${idx}`}
              style={{
                paddingVertical: 8,
                borderBottomWidth: idx < lines.length - 1 ? 1 : 0,
                borderBottomColor: t.colors.border,
              }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "600" as const }}>
                {String((ln as any).itemId || "—")}
              </Text>
              <Text style={{ color: t.colors.muted }}>qty: {String((ln as any).qty ?? 1)}</Text>
            </View>
          ))
        ) : (
          <Text style={{ color: t.colors.muted }}>No lines yet.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
  keyboardType,
}: {
  label: string;
  value?: any;
  onChangeText: (v: any) => void;
  multiline?: boolean;
  keyboardType?: any;
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
          backgroundColor: t.colors.bg,
          color: t.colors.text,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}

function PillGroup({
  options,
  value,
  onChange,
}: {
  options: string[];
  value?: string;
  onChange: (v: string) => void;
}) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: selected ? t.colors.primary : t.colors.border,
              backgroundColor: selected ? t.colors.primary : t.colors.card,
            }}
          >
            <Text
              style={{
                color: selected ? t.colors.buttonText : t.colors.text,
                fontWeight: "600" as const,
              }}
            >
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
