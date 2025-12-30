// apps/mobile/src/screens/EditSalesOrderScreen.tsx
import * as React from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useToast } from "../features/_shared/Toast";
import { apiClient } from "../api/client";
import { computePatchLinesDiff } from "../lib/patchLinesDiff"; // added in E3
import type { RootStackParamList } from "../navigation/types";

// Minimal line shape for editing
type Line = {
  id?: string;
  cid?: string;
  itemId?: string;
  qty?: number;
  uom?: string;
};

type SalesOrder = {
  id: string;
  status?: string;
  lines?: Line[];
};

const PATCH_FIELDS = ["itemId", "qty", "uom"] as const;
const ALLOWED_STATUSES = new Set(["draft", "submitted", "approved"]);

export default function EditSalesOrderScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "EditSalesOrder">>();
  const nav = useNavigation<any>();
  const toast = useToast();
  const { soId } = route.params;
  const cidCounter = React.useRef(1);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string>("");
  const [originalLines, setOriginalLines] = React.useState<Line[]>([]);
  const [currentLines, setCurrentLines] = React.useState<Line[]>([]);

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
        const lines = Array.isArray(body?.lines) ? body.lines : [];
        const normalized: Line[] = lines.map((ln: any) => ({
          id: ln?.id ? String(ln.id).trim() : undefined,
          cid: ln?.cid ? String(ln.cid).trim() : undefined,
          itemId: ln?.itemId ? String(ln.itemId).trim() : "",
          qty: Number(ln?.qty ?? 0) || 0,
          uom: ln?.uom ? String(ln.uom).trim() || "ea" : "ea",
        }));
        if (!mounted) return;
        const maxTmp = normalized.reduce((max, ln) => {
          const rawCid = ln.cid || (ln.id && String(ln.id).startsWith("tmp-") ? String(ln.id) : "");
          if (!rawCid || !rawCid.startsWith("tmp-")) return max;
          const n = Number(rawCid.replace("tmp-", ""));
          return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);
        cidCounter.current = Math.max(cidCounter.current, maxTmp + 1);
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

  const handleChange = (key: keyof Line, value: string | number, idx: number) => {
    setCurrentLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx] };
      if (key === "qty") {
        const n = Number(value);
        line.qty = Number.isFinite(n) ? n : 0;
      } else if (key === "itemId" || key === "uom") {
        line[key] = typeof value === "string" ? value : String(value ?? "");
      }
      next[idx] = line;
      return next;
    });
  };

  const handleRemove = (idx: number) => {
    setCurrentLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const nextCid = React.useCallback(() => {
    const value = cidCounter.current;
    cidCounter.current += 1;
    return `tmp-${value}`;
  }, []);

  const handleAddLine = () => {
    setCurrentLines((prev) => [
      ...prev,
      { cid: nextCid(), itemId: "", qty: 1, uom: "ea" },
    ]);
  };

  const save = async () => {
    if (!soId || saving) return;
    if (!canEdit) {
      toast("Order not editable in this status", "warning");
      return;
    }

    try {
      const normalizedLines = currentLines.map((ln) => ({
        ...ln,
        itemId: (ln.itemId ?? "").trim(),
        uom: (ln.uom ?? "").trim(),
        qty: Number(ln.qty ?? 0) || 0,
      }));

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

      const ops = computePatchLinesDiff(originalLines, normalizedLines, PATCH_FIELDS as any);
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>
        {currentLines.map((line, idx) => {
          const key = line.id || line.cid || String(idx);
          return (
            <View key={key} style={{ padding: 10, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, gap: 8 }}>
              <Text style={{ fontWeight: "600" }}>Line {line.id || line.cid}</Text>
              <View style={{ gap: 6 }}>
                <Text>Item</Text>
                <TextInput
                  editable={canEdit}
                  value={line.itemId ?? ""}
                  onChangeText={(v) => handleChange("itemId", v, idx)}
                  placeholder="Item ID"
                  style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text>Qty</Text>
                <TextInput
                  editable={canEdit}
                  keyboardType="numeric"
                  value={String(line.qty ?? 0)}
                  onChangeText={(v) => handleChange("qty", v, idx)}
                  style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text>UOM</Text>
                <TextInput
                  editable={canEdit}
                  value={line.uom ?? "ea"}
                  onChangeText={(v) => handleChange("uom", v || "ea", idx)}
                  style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 }}
                />
              </View>
              <Pressable
                disabled={!canEdit}
                onPress={() => handleRemove(idx)}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: "#d32f2f",
                  backgroundColor: canEdit ? "#ffebee" : "#f5f5f5",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#d32f2f", fontWeight: "700" }}>Remove</Text>
              </Pressable>
            </View>
          );
        })}

        <Pressable
          disabled={!canEdit}
          onPress={handleAddLine}
          style={{
            padding: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: "#1976d2",
            backgroundColor: canEdit ? "#e3f2fd" : "#f5f5f5",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#1976d2", fontWeight: "700" }}>+ Add Line</Text>
        </Pressable>
      </ScrollView>

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
