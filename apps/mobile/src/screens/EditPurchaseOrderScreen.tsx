// apps/mobile/src/screens/EditPurchaseOrderScreen.tsx
import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useToast } from "../features/_shared/Toast";
import { apiClient, patchPurchaseOrderLines } from "../api/client";
import { computePatchLinesDiff, PURCHASE_ORDER_PATCHABLE_LINE_FIELDS } from "../lib/patchLinesDiff";
import type { RootStackParamList } from "../navigation/types";
import { track, trackScreenView } from "../lib/telemetry";
import { LineEditor, EditableLine } from "../components/LineEditor";

export type PurchaseOrder = {
  id: string;
  status?: string;
  lines?: EditableLine[];
};

type RouteProps = RouteProp<RootStackParamList, "EditPurchaseOrder">;

const PATCH_FIELDS = PURCHASE_ORDER_PATCHABLE_LINE_FIELDS;

export default function EditPurchaseOrderScreen() {
  const route = useRoute<RouteProps>();
  const nav = useNavigation<any>();
  const toast = useToast();
  const routeParams = route.params as any;
  const poId: string | undefined = routeParams?.id ?? routeParams?.poId; // allow legacy poId param
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string>("");
  const [originalLines, setOriginalLines] = React.useState<EditableLine[]>([]);
  const [currentLines, setCurrentLines] = React.useState<EditableLine[]>([]);
  const [trackedOpen, setTrackedOpen] = React.useState(false);

  // Load purchase order
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!poId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<PurchaseOrder>(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
        const body = (res as any)?.body ?? res;
        const lines = Array.isArray(body?.lines) ? body.lines : [];
        const normalized: EditableLine[] = lines.map((ln: any) => ({
          id: ln?.id ? String(ln.id).trim() : undefined,
          cid: ln?.cid ? String(ln.cid).trim() : undefined,
          itemId: ln?.itemId ? String(ln.itemId).trim() : "",
          qty: Number(ln?.qty ?? 0) || 0,
          uom: ln?.uom ? String(ln.uom).trim() || "ea" : "ea",
        }));
        if (!mounted) return;
        const normalizedStatus = String(body?.status ?? "");
        setStatus(normalizedStatus);
        setOriginalLines(normalized);
        setCurrentLines(normalized);

        if (poId && !trackedOpen) {
          const statusLower = normalizedStatus.toLowerCase();
          trackScreenView("PurchaseOrderEdit", {
            objectType: "purchaseOrder",
            objectId: poId,
            status: statusLower || undefined,
          });
          try {
            const Sentry = require("@sentry/react-native");
            Sentry.setTag("screen", "PurchaseOrderEdit");
            Sentry.setTag("route", "EditPurchaseOrder");
            Sentry.setTag("objectType", "purchaseOrder");
            Sentry.setTag("objectId", poId);
            if (statusLower) Sentry.setTag("poStatus", statusLower);
          } catch {
            // Sentry not available
          }
          setTrackedOpen(true);
        }
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message || "Failed to load PO");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [poId, trackedOpen]);

  const canEdit = String(status || "").toLowerCase() === "draft";

  const save = async () => {
    if (!poId || saving) return;
    if (!canEdit) {
      toast("PO not editable (draft only)", "warning");
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
        const label = `Line ${i + 1}`;
        if (!line.itemId) {
          toast(`${label}: Item is required`, "warning");
          return;
        }
        if (!line.uom) {
          toast(`${label}: UOM is required`, "warning");
          return;
        }
        if (!(Number(line.qty) > 0)) {
          toast(`${label}: Qty must be greater than 0`, "warning");
          return;
        }
      }

      setSaving(true);
      setCurrentLines(normalizedLines);

      const ops = computePatchLinesDiff({
        originalLines,
        editedLines: normalizedLines,
        patchableFields: PATCH_FIELDS,
      });

      const upsertCount = ops.filter((op) => op.op === "upsert").length;
      const removeCount = ops.filter((op) => op.op === "remove").length;
      const statusLower = String(status || "").toLowerCase();
      const baseTelemetry = {
        objectType: "purchaseOrder",
        objectId: poId,
        status: statusLower || undefined,
        opCount: ops.length,
        upsertCount,
        removeCount,
      };

      if (!ops || ops.length === 0) {
        track("po_edit_submit", { ...baseTelemetry, result: "no_op" });
        toast("No changes", "info");
        nav.goBack();
        return;
      }

      track("po_edit_submit", { ...baseTelemetry, result: "attempt" });

      await patchPurchaseOrderLines(poId, ops);

      track("po_edit_submit", { ...baseTelemetry, result: "success" });

      // Hint detail screen to refresh
      nav.navigate({ name: "PurchaseOrderDetail", params: { id: poId, didEdit: true }, merge: true } as any);
      nav.goBack();
    } catch (err: any) {
      const code = err?.code || err?.body?.code || err?.status;
      const httpStatus = err?.status || err?.body?.status || err?.response?.status;
      const msg = err?.message || err?.body?.message || "Save failed";
      track("po_edit_submit", {
        objectType: "purchaseOrder",
        objectId: poId,
        status: String(status || "").toLowerCase() || undefined,
        result: "error",
        httpStatus: httpStatus || "unknown",
        errorCode: code || "unknown",
      });

      try {
        const Sentry = require("@sentry/react-native");
        const poStatus = String(status || "").toLowerCase();
        Sentry.captureException(err, {
          tags: {
            screen: "PurchaseOrderEdit",
            route: "EditPurchaseOrder",
            objectType: "purchaseOrder",
            objectId: poId,
            ...(poStatus ? { poStatus } : {}),
          },
          extra: {
            httpStatus: httpStatus || "unknown",
            errorCode: code || "unknown",
          },
        });
      } catch {
        // Sentry not available
      }
      if (code === "PO_NOT_EDITABLE" || code === 409) {
        toast("Purchase order cannot be edited in current status", "warning");
        nav.navigate({ name: "PurchaseOrderDetail", params: { id: poId }, merge: true } as any);
      } else {
        toast(msg, "error");
      }
      if (__DEV__) {
        console.warn("EditPurchaseOrder save error", err);
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
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Edit Purchase Order</Text>
        <Text>ID: {poId}</Text>
        <Text>Status: {status || ""}</Text>
        {!canEdit && (
          <Text style={{ color: "#b00020", marginTop: 6 }}>
            Purchase order can only be edited in draft status.
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
