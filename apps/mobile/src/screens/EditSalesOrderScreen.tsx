// apps/mobile/src/screens/EditSalesOrderScreen.tsx
import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useToast } from "../features/_shared/Toast";
import { apiClient } from "../api/client";
import { computePatchLinesDiff, PATCHABLE_LINE_FIELDS } from "../lib/patchLinesDiff"; // added in E3
import { buildEditableLines, normalizeEditableLines } from "../lib/buildEditableLines";
import type { RootStackParamList } from "../navigation/types";
import { LineEditor, EditableLine } from "../components/LineEditor";

type SalesOrder = {
  id: string;
  status?: string;
  lines?: EditableLine[];
};

const ALLOWED_STATUSES = new Set(["draft", "submitted", "approved"]);

export default function EditSalesOrderScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "EditSalesOrder">>();
  const nav = useNavigation<any>();
  const toast = useToast();
  const { soId } = route.params;
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string>("");
  const [originalLines, setOriginalLines] = React.useState<EditableLine[]>([]);
  const [currentLines, setCurrentLines] = React.useState<EditableLine[]>([]);

  // Load sales order
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!soId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<SalesOrder>(`/objects/salesOrder/${encodeURIComponent(soId)}`);
        const body = (res as any)?.body ?? res;
        const normalized = buildEditableLines(Array.isArray(body?.lines) ? body.lines : []);
        if (!mounted) return;
        setStatus(String(body?.status ?? ""));
        setOriginalLines(normalized);
        setCurrentLines(normalized);
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message || "Failed to load order");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [soId]);

  const canEdit = ALLOWED_STATUSES.has((status || "").toLowerCase());

  const save = async () => {
    if (!soId || saving) return;
    if (!canEdit) {
      toast("Order not editable in this status", "warning");
      return;
    }

    try {
      const normalizedLines = normalizeEditableLines(currentLines);

      for (let i = 0; i < normalizedLines.length; i++) {
        const line = normalizedLines[i];
        const lineLabel = `Line ${i + 1}`;
        if (!line.itemId) {
          toast(`${lineLabel}: Item is required`, "warning");
          return;
        }
        if (!line.uom) {
          toast(`${lineLabel}: UOM is required`, "warning");
          return;
        }
        if (!(Number(line.qty) > 0)) {
          toast(`${lineLabel}: Qty must be greater than 0`, "warning");
          return;
        }
      }

      setSaving(true);

      // Ensure state reflects trimmed values for any subsequent edits
      setCurrentLines(normalizedLines);

      const ops = computePatchLinesDiff({
        originalLines,
        editedLines: normalizedLines,
        patchableFields: PATCHABLE_LINE_FIELDS as any,
      });
      if (!ops || ops.length === 0) {
        nav.goBack();
        return;
      }

      await apiClient.post(`/sales/so/${encodeURIComponent(soId)}:patch-lines`, { ops });

      // Hint detail screen to refresh
      nav.navigate({ name: "SalesOrderDetail", params: { id: soId, didEdit: true }, merge: true } as any);
      nav.goBack();
    } catch (err: any) {
      const msg = err?.message || err?.body?.message || "Save failed";
      toast(msg, "error");
      if (__DEV__) {
        console.warn("EditSalesOrder save error", err);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;
  if (error) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ color: "#b00020", marginBottom: 12 }}>{error}</Text>
        <Pressable onPress={() => nav.goBack()} style={{ padding: 12 }}>
          <Text style={{ color: "#007aff", fontWeight: "600" }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Edit Sales Order</Text>
        <Text>ID: {soId}</Text>
        <Text>Status: {status || ""}</Text>
        {!canEdit && (
          <Text style={{ color: "#b00020", marginTop: 6 }}>
            Order cannot be edited in this status.
          </Text>
        )}
      </View>

      <LineEditor lines={currentLines} onChange={setCurrentLines} canEdit={canEdit} />

      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
        <Pressable
          onPress={() => nav.goBack()}
          style={{
            flex: 1,
            padding: 14,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: "#ccc",
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "600" }}>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canEdit || saving}
          onPress={save}
          style={{
            flex: 1,
            padding: 14,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: canEdit ? "#2e7d32" : "#ccc",
            backgroundColor: canEdit ? "#e8f5e9" : "#f5f5f5",
            opacity: saving ? 0.6 : 1,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "700", color: canEdit ? "#2e7d32" : "#888" }}>
            {saving ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
