// apps/mobile/src/screens/EditPurchaseOrderScreen.tsx
import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useToast } from "../features/_shared/Toast";
import { apiClient, patchPurchaseOrderLines } from "../api/client";
import { computePatchLinesDiff, PATCHABLE_LINE_FIELDS } from "../lib/patchLinesDiff";
import { getPatchLinesErrorMessage, isPatchLinesStatusGuardError } from "../lib/patchLinesErrors";
import type { RootStackParamList } from "../navigation/types";
import { track, trackScreenView } from "../lib/telemetry";
import { LineEditor, EditableLine } from "../components/LineEditor";
import { buildEditableLines, normalizeEditableLines } from "../lib/buildEditableLines";
import { validateEditableLines } from "../lib/validateEditableLines";

export type PurchaseOrder = {
  id: string;
  status?: string;
  lines?: EditableLine[];
};

type RouteProps = RouteProp<RootStackParamList, "EditPurchaseOrder">;

const PATCH_FIELDS = PATCHABLE_LINE_FIELDS;

export default function EditPurchaseOrderScreen() {
  const route = useRoute<RouteProps>();
  const nav = useNavigation<any>();
  const toast = useToast();
  const routeParams = route.params as any;
  const poId: string | undefined = routeParams?.purchaseOrderId ?? routeParams?.id ?? routeParams?.poId; // allow purchaseOrderId or legacy id/poId
  const isMounted = React.useRef(true);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string>("");
  const [originalLines, setOriginalLines] = React.useState<EditableLine[]>([]);
  const [currentLines, setCurrentLines] = React.useState<EditableLine[]>([]);
  const [trackedOpen, setTrackedOpen] = React.useState(false);

  React.useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadPo = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!poId || !isMounted.current) return null;
      const silent = opts?.silent === true;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<PurchaseOrder>(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
        const body = (res as any)?.body ?? res;
        const normalizedStatus = String(body?.status ?? "");
        const normalizedLines = buildEditableLines(Array.isArray(body?.lines) ? body?.lines : []);

        if (!isMounted.current) return null;

        setStatus(normalizedStatus);
        setOriginalLines(normalizedLines);
        setCurrentLines(normalizedLines);

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

        return { status: normalizedStatus, lines: normalizedLines };
      } catch (err: any) {
        if (!isMounted.current) return null;
        if (!silent) setError(err?.message || "Failed to load PO");
        throw err;
      } finally {
        if (!silent && isMounted.current) setLoading(false);
      }
    },
    [buildEditableLines, poId, trackedOpen]
  );

  // Load purchase order
  React.useEffect(() => {
    loadPo().catch(() => {});
  }, [loadPo]);

  const canEdit = String(status || "").toLowerCase() === "draft";

  const save = async () => {
    if (!poId || saving) return;

    const statusLower = String(status || "").toLowerCase();
    const baseClick = {
      objectId: poId,
      objectType: "purchaseOrder",
      status: statusLower || undefined,
      lineCount: currentLines.length,
    };

    track("po_edit_lines_clicked", { ...baseClick, result: "attempt" });

    if (!canEdit) {
      track("po_edit_lines_submitted", { ...baseClick, result: "fail", errorCode: "PO_NOT_EDITABLE" });
      toast("PO is not editable unless Draft", "warning");
      return;
    }

    try {
      const normalizedLines = normalizeEditableLines(currentLines);

      const validation = validateEditableLines(normalizedLines);
      if (!validation.ok) {
        track("po_edit_lines_submitted", { ...baseClick, result: "fail", errorCode: "VALIDATION" });
        toast(validation.message, "warning");
        return;
      }

      setSaving(true);
      setCurrentLines(normalizedLines);

      const ops = computePatchLinesDiff({
        originalLines,
        editedLines: normalizedLines,
        patchableFields: PATCH_FIELDS,
      });

      if (!ops || ops.length === 0) {
        toast("No changes", "info");
        return;
      }

      const submissionTelemetry = {
        objectId: poId,
        objectType: "purchaseOrder",
        status: statusLower || undefined,
        lineCount: ops.length,
      };

      track("po_edit_lines_submitted", { ...submissionTelemetry, result: "attempt" });

      await patchPurchaseOrderLines(poId, ops);

      track("po_edit_lines_submitted", { ...submissionTelemetry, result: "success" });

      // Refresh PO then return with didEdit flag
      await loadPo({ silent: true }).catch(() => {});
      nav.navigate({ name: "PurchaseOrderDetail", params: { id: poId, didEdit: true }, merge: true } as any);
      nav.goBack();
    } catch (err: any) {
      // Use shared error handler for consistent 409/status guard messages
      const isGuard = isPatchLinesStatusGuardError(err);
      const { message } = getPatchLinesErrorMessage(err, "PO");
      
      const httpStatus = err?.status || err?.body?.status || err?.response?.status;
      const code = err?.body?.code || err?.code || httpStatus;
      const normalizedCode = isGuard ? "PO_NOT_EDITABLE" : (code || "unknown");

      track("po_edit_lines_submitted", {
        objectId: poId,
        objectType: "purchaseOrder",
        status: statusLower || undefined,
        lineCount: Array.isArray(err?.ops) ? err.ops.length : currentLines.length,
        result: "fail",
        errorCode: normalizedCode,
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

      // Show message but KEEP local edits in UI (don't navigate away or wipe)
      toast(message, isGuard ? "warning" : "error");

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
