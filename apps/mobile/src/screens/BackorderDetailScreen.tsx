// apps/mobile/src/screens/BackorderDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, Pressable, ScrollView, Alert } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { track, trackScreenView } from "../lib/telemetry";
import { useObjects } from "../features/_shared/useObjects";
import { useColors } from "../features/_shared/useColors";
import { apiClient } from "../api/client";
import { useToast } from "../features/_shared/Toast";
import { copyText } from "../features/_shared/copy";
import { suggestPurchaseOrders, saveFromSuggestion, type PurchaseOrderDraft } from "../features/purchasing/poActions";

type BackorderRequest = {
  id: string;
  soId?: string;
  soLineId?: string;
  itemId?: string;
  qty?: number;
  status?: string;
  preferredVendorId?: string;
  createdAt?: string;
  updatedAt?: string;
  fulfilledQty?: number | null;
  remainingQty?: number | null;
};

type SalesOrder = {
  id: string;
  status?: string;
  partyId?: string;
};

type InventoryItem = {
  id: string;
  name?: string;
  productId?: string;
  description?: string;
};

type Party = {
  id: string;
  name?: string;
  type?: string;
};

export default function BackorderDetailScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const id = route.params?.id as string | undefined;
  const t = useColors();
  const toast = useToast();

  const { data: backorder, isLoading, error, refetch } = useObjects<BackorderRequest>({ 
    type: "backorderRequest", 
    id,
    enabled: !!id 
  });

  const { data: salesOrder } = useObjects<SalesOrder>({ 
    type: "salesOrder", 
    id: backorder?.soId,
    enabled: !!backorder?.soId 
  });

  const { data: item } = useObjects<InventoryItem>({ 
    type: "inventory", 
    id: backorder?.itemId,
    enabled: !!backorder?.itemId 
  });

  const { data: vendor } = useObjects<Party>({ 
    type: "party", 
    id: backorder?.preferredVendorId,
    enabled: !!backorder?.preferredVendorId 
  });

  const [actionLoading, setActionLoading] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      void refetch?.();
    }, [refetch])
  );

  // Track screen view when loaded
  React.useEffect(() => {
    if (id && backorder?.id) {
      trackScreenView("BackorderDetail", { objectType: "backorderRequest", objectId: id });
    }
  }, [id, backorder?.id]);

  const handleSuggestPo = () => {
    if (!backorder?.id) return;
    nav.navigate("SuggestPurchaseOrders", {
      backorderRequestIds: [backorder.id],
      vendorId: backorder.preferredVendorId,
    });
  };

  const handleIgnore = async () => {
    if (!id || backorder?.status !== "open") return;
    
    Alert.alert(
      "Ignore Backorder",
      "This will mark the backorder as ignored. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Ignore",
          style: "destructive",
          onPress: async () => {
            setActionLoading(true);
            try {
              await apiClient.post(`/objects/backorderRequest/${encodeURIComponent(id)}:ignore`, {});
              toast("Backorder ignored", "success");
                // UX event: ignore clicked (success)
                track("BO_Ignore_Clicked", { objectType: "backorderRequest", objectId: id, result: "success" });
              await refetch?.();
            } catch (err: any) {
              console.error(err);
                // UX event: ignore clicked (fail)
                track("BO_Ignore_Clicked", { objectType: "backorderRequest", objectId: id, result: "fail", errorCode: err?.code || err?.status });
                // Sentry capture with tags (safe dynamic require)
                try {
                  const Sentry = require("@sentry/react-native");
                  Sentry.captureException(err, { tags: { objectType: "backorderRequest", objectId: id } });
                } catch {}
              Alert.alert("Error", err?.message || "Failed to ignore backorder");
            } finally {
              setActionLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleConvert = async () => {
    if (!id || backorder?.status !== "open") return;

    Alert.alert(
      "Convert Backorder",
      "Convert this backorder and suggest a purchase order?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Convert",
          onPress: async () => {
            setActionLoading(true);
            try {
              await apiClient.post(`/objects/backorderRequest/${encodeURIComponent(id)}:convert`, {});
              toast("Converted", "success");
              track("BO_Convert_Clicked", { objectType: "backorderRequest", objectId: id, result: "success" });

              const res = await suggestPurchaseOrders([id], backorder?.preferredVendorId ? { vendorId: backorder.preferredVendorId } : {});
              const drafts: PurchaseOrderDraft[] = Array.isArray(res?.drafts) ? res?.drafts : res?.draft ? [res.draft] : [];
              const skipped = Array.isArray(res?.skipped) ? res?.skipped : [];
              if (skipped.length) {
                const reasons = skipped
                  .slice(0, 2)
                  .map((s) => s?.reason || "skipped")
                  .join(", ");
                toast(`Skipped ${skipped.length}: ${reasons}${skipped.length > 2 ? "..." : ""}`, "info");
              }

              if (drafts.length === 1) {
                const createRes = await saveFromSuggestion(drafts[0]);
                const createdId = createRes?.id ?? createRes?.ids?.[0];
                if (createdId) {
                  nav.navigate("PurchaseOrderDetail", { id: createdId });
                } else {
                  nav.navigate("SuggestPurchaseOrders", { backorderRequestIds: [id], vendorId: backorder?.preferredVendorId });
                }
              } else if (drafts.length > 1) {
                nav.navigate("SuggestPurchaseOrders", { backorderRequestIds: [id], vendorId: backorder?.preferredVendorId });
              } else {
                toast("No drafts returned", "info");
              }

              await refetch?.();
            } catch (err: any) {
              console.error(err);
              track("BO_Convert_Clicked", { objectType: "backorderRequest", objectId: id, result: "fail", errorCode: err?.code || err?.status });
              Alert.alert("Error", err?.message || "Failed to convert backorder");
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString();
  };

  const getStatusColor = (status?: string): string => {
    switch (status) {
      case "open": return "#b00020";
      case "converted": return "#1976d2";
      case "fulfilled": return "#2e7d32";
      case "ignored": return "#666";
      default: return "#999";
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12, color: t.colors.textMuted }}>Loading backorder...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ color: "#b00020", marginBottom: 12 }}>
          Error: {(error as any)?.message || "Failed to load backorder"}
        </Text>
        <Pressable
          onPress={() => nav.goBack()}
          style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.colors.border, borderRadius: 8, alignSelf: "flex-start" }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!backorder) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ marginBottom: 12 }}>Backorder not found</Text>
        <Pressable
          onPress={() => nav.goBack()}
          style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.colors.border, borderRadius: 8, alignSelf: "flex-start" }}
        >
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  const hasProgressFields = backorder.remainingQty != null || backorder.fulfilledQty != null;
  const progress = backorder.fulfilledQty != null && backorder.qty ? (backorder.fulfilledQty / backorder.qty) * 100 : 0;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {/* Header */}
      <View style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: t.colors.text }}>Backorder Detail</Text>
          {backorder.status === "open" && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={handleSuggestPo}
                disabled={actionLoading}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  backgroundColor: actionLoading ? t.colors.border : t.colors.primary,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: t.colors.buttonText || "#fff", fontWeight: "600", fontSize: 12 }}>
                  {actionLoading ? "Working..." : "Suggest PO"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleConvert}
                disabled={actionLoading}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  backgroundColor: actionLoading ? t.colors.border : "#2e7d32",
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>
                  {actionLoading ? "Working..." : "Convert"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleIgnore}
                disabled={actionLoading}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  backgroundColor: actionLoading ? t.colors.border : "#666",
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>
                  {actionLoading ? "Ignoring..." : "Ignore"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
        <Pressable
          onLongPress={async () => {
            if (backorder.id) {
              await copyText(backorder.id);
              toast("Copied", "success");
            }
          }}
        >
          <Text style={{ fontSize: 13, color: t.colors.textMuted }}>ID: {backorder.id}</Text>
        </Pressable>
      </View>

      {/* Status Badge */}
      <View
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: getStatusColor(backorder.status) + "20",
          borderRadius: 6,
          marginBottom: 16,
        }}
      >
        <Text style={{ color: getStatusColor(backorder.status), fontWeight: "700", fontSize: 12, textTransform: "uppercase" }}>
          {backorder.status || "unknown"}
        </Text>
      </View>

      {/* Key Fields */}
      <View style={{ marginBottom: 20, padding: 12, backgroundColor: t.colors.card, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}>
        <InfoRow label="Quantity" value={`${backorder.qty ?? 0} units`} colors={t.colors} />
        
        {hasProgressFields && (
          <>
            {backorder.fulfilledQty != null && (
              <InfoRow label="Fulfilled Qty" value={`${backorder.fulfilledQty} units`} colors={t.colors} valueColor="#2e7d32" />
            )}
            {backorder.remainingQty != null && (
              <InfoRow 
                label="Remaining Qty" 
                value={`${backorder.remainingQty} units`} 
                colors={t.colors} 
                valueColor={backorder.remainingQty > 0 ? "#b00020" : "#2e7d32"} 
              />
            )}
            {backorder.fulfilledQty != null && backorder.qty && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: t.colors.text, marginBottom: 4 }}>Progress</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1, height: 20, backgroundColor: "#eee", borderRadius: 4, overflow: "hidden" }}>
                    <View
                      style={{
                        height: "100%",
                        backgroundColor: "#2e7d32",
                        width: `${Math.min(100, progress)}%`,
                      }}
                    />
                  </View>
                  <Text style={{ fontSize: 12, color: t.colors.textMuted, minWidth: 40 }}>{Math.round(progress)}%</Text>
                </View>
              </View>
            )}
          </>
        )}
        
        <InfoRow label="Created" value={formatDateTime(backorder.createdAt)} colors={t.colors} />
        {backorder.updatedAt && <InfoRow label="Updated" value={formatDateTime(backorder.updatedAt)} colors={t.colors} />}
      </View>

      {/* Sales Order Context */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: "#f0f7ff", borderRadius: 8, borderWidth: 1, borderColor: "#cce5ff" }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#1976d2", marginBottom: 8 }}>Sales Order Context</Text>
        <InfoRow label="SO ID" value={backorder.soId || "—"} colors={t.colors} />
        {salesOrder && (
          <>
            <InfoRow label="SO Status" value={salesOrder.status || "—"} colors={t.colors} />
            <InfoRow label="Customer" value={salesOrder.partyId || "—"} colors={t.colors} />
          </>
        )}
        <InfoRow label="SO Line ID" value={backorder.soLineId || "—"} colors={t.colors} />
        
        {backorder.soId && (
          <Pressable
            onPress={() => nav.navigate("SalesOrderDetail", { id: backorder.soId })}
            style={{ marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#1976d2", borderRadius: 6, alignSelf: "flex-start" }}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>View Sales Order →</Text>
          </Pressable>
        )}
      </View>

      {/* Item Context */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: t.colors.card, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: t.colors.text, marginBottom: 8 }}>Item Context</Text>
        <InfoRow label="Item ID" value={backorder.itemId || "—"} colors={t.colors} />
        {item && (
          <>
            {item.name && <InfoRow label="Name" value={item.name} colors={t.colors} />}
            {item.description && <InfoRow label="Description" value={item.description} colors={t.colors} />}
            {item.productId && <InfoRow label="Product ID" value={item.productId} colors={t.colors} />}
          </>
        )}
        
        {backorder.itemId && (
          <Pressable
            onPress={() => nav.navigate("InventoryDetail", { id: backorder.itemId })}
            style={{ marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.colors.primary, borderRadius: 6, alignSelf: "flex-start" }}
          >
            <Text style={{ color: t.colors.buttonText || "#fff", fontWeight: "600", fontSize: 12 }}>View Item →</Text>
          </Pressable>
        )}
      </View>

      {/* Vendor Context */}
      {backorder.preferredVendorId && (
        <View style={{ marginBottom: 16, padding: 12, backgroundColor: t.colors.card, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: t.colors.text, marginBottom: 8 }}>Vendor Context</Text>
          <InfoRow label="Vendor ID" value={backorder.preferredVendorId} colors={t.colors} />
          {vendor?.name && <InfoRow label="Vendor Name" value={vendor.name} colors={t.colors} />}
          
          <Pressable
            onPress={() => nav.navigate("PartyDetail", { id: backorder.preferredVendorId })}
            style={{ marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.colors.primary, borderRadius: 6, alignSelf: "flex-start" }}
          >
            <Text style={{ color: t.colors.buttonText || "#fff", fontWeight: "600", fontSize: 12 }}>View Vendor →</Text>
          </Pressable>
        </View>
      )}

      {/* PO Linkage Note */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: "#f0f7ff", borderRadius: 8, borderWidth: 1, borderColor: "#cce5ff" }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: "#1976d2", marginBottom: 4 }}>Purchase Order Linkage</Text>
        <Text style={{ fontSize: 11, color: "#555", lineHeight: 16 }}>
          To find which PO lines are fulfilling this backorder, navigate to Purchase Orders and check PO detail pages for lines with matching backorder IDs.
        </Text>
      </View>
    </ScrollView>
  );
}

function InfoRow({ 
  label, 
  value, 
  colors, 
  valueColor 
}: { 
  label: string; 
  value: string; 
  colors: any; 
  valueColor?: string;
}) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text, width: 120 }}>{label}:</Text>
      <Text style={{ fontSize: 12, color: valueColor || colors.textMuted, flex: 1 }}>{value}</Text>
    </View>
  );
}
