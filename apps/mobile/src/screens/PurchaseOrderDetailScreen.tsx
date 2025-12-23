import * as React from "react";
import { View, Text, ActivityIndicator, FlatList, Pressable, Modal, TextInput } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { FEATURE_PO_QUICK_RECEIVE } from "../features/_shared/flags";
import { saveFromSuggestion, receiveAll, receiveLine, submit, approve, cancel, close } from "../features/purchasing/poActions";
import { useToast } from "../features/_shared/Toast";
import { copyText } from "../features/_shared/copy";
import { ReceiveHistorySheet } from "../features/purchasing/ReceiveHistorySheet";
import { VendorGuardBanner } from "../features/_shared/VendorGuardBanner";
import PartySelectorModal from "../features/parties/PartySelectorModal";
import { updateObject } from "../api/client";
import { useTheme } from "../providers/ThemeProvider";

export default function PurchaseOrderDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string | undefined;

  const { data, isLoading, refetch } = useObjects<any>({ type: "purchaseOrder", id });
  const po = data;
  const { data: vendorParty } = useObjects<any>({ type: "party", id: po?.vendorId });
  const lines = (po?.lines ?? []) as any[];
  const toast = useToast();

  const [modal, setModal] = React.useState<{ open: boolean; lineId?: string; itemId?: string }>({ open: false });
  const [qty, setQty] = React.useState<string>("1");
  const [lot, setLot] = React.useState<string>("");
  const [locationId, setLocationId] = React.useState<string>("");

  const [history, setHistory] = React.useState<{ open: boolean; itemId?: string; lineId?: string }>({ open: false });
  const [vendorModalOpen, setVendorModalOpen] = React.useState(false);

  if (isLoading) return <ActivityIndicator />;

  // Deterministic idempotency key per (poId, lineId, qty, lot, location)
  const makeIdk = (poId: string, lineId: string, n: number, l?: string, loc?: string) =>
    `po:${poId}#ln:${lineId}#q:${n}#lot:${l || ""}#loc:${loc || ""}`;

  async function onReceiveLine() {
    if (!po?.id || !modal.lineId) return;
    const n = Number(qty || "0");
    if (!Number.isFinite(n) || n <= 0) { toast("Enter a qty > 0"); return; }
    try {
      await receiveLine(
        po.id,
        { lineId: modal.lineId, deltaQty: n, lot: lot || undefined, locationId: locationId || undefined },
        { idempotencyKey: makeIdk(po.id, modal.lineId, n, lot || undefined, locationId || undefined) }
      );
      setModal({ open: false });
      setQty("1"); setLot(""); setLocationId("");
      toast("Received", "success");
      await refetch();
    } catch (e: any) {
      console.error(e);
      toast(e?.message || "Receive failed", "error");
    }
  }

  const receivable = po?.status === "approved" || po?.status === "partially_fulfilled";
  // Match banner semantics: vendor must exist AND have the "vendor" role
  const vendorHasRole =
    !!(vendorParty?.roles?.includes("vendor")) ||
    !!(po?.vendorHasVendorRole === true) ||
    !!(Array.isArray((po as any)?.vendorRoles) && (po as any).vendorRoles.includes("vendor"));
  const vendorGuardActive = !po?.vendorId || !vendorHasRole;

  // Status-aware gating
  const canSubmit = po?.status === "draft" && !vendorGuardActive;
  const canApprove = po?.status === "submitted" && !vendorGuardActive;
  const canCancel = (po?.status === "draft" || po?.status === "submitted") && po?.status !== "cancelled" && po?.status !== "canceled" && po?.status !== "closed";
  const canClose = (po?.status === "approved" || po?.status === "received" || po?.status === "partially_fulfilled" || po?.status === "fulfilled") && po?.status !== "cancelled" && po?.status !== "canceled" && po?.status !== "closed";

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Purchase Order </Text>
        <Pressable
          onLongPress={async () => {
            if (po?.id) {
              await copyText(String(po.id));
              toast("Copied", "success");
            }
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700" }}>{po?.id}</Text>
        </Pressable>
      </View>
      <Text>Status: {po?.status}</Text>

      {/* Vendor identity row */}
      <View style={{ marginTop: 8, marginBottom: 4, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Vendor:</Text>
        <Text style={{ flexShrink: 1 }}>
          {vendorParty?.name || vendorParty?.displayName || po?.vendorId || "(required)"}
        </Text>
        <Pressable onPress={() => setVendorModalOpen(true)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 6 }}>
          <Text>Change</Text>
        </Pressable>
        {!!po?.vendorId && (
          <Pressable onPress={() => navigation.navigate("PartyDetail", { id: po?.vendorId })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 6 }}>
            <Text>Open</Text>
          </Pressable>
        )}
      </View>

      {/* Vendor Guard (friendly banner when missing/invalid vendor) */}
      <View style={{ marginTop: 10 }}>
        <VendorGuardBanner
          vendorId={po?.vendorId}
          vendorHasRole={!vendorGuardActive}
          onChangeVendor={() => setVendorModalOpen(true)}
        />
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {po?.status === "draft" && (
          <Pressable
            onPress={async () => {
              try {
                const r = await saveFromSuggestion(po);
                const newId = (r as any)?.id ?? (r as any)?.ids?.[0];
                if (newId && newId !== po?.id) navigation.replace("PurchaseOrderDetail", { id: newId });
                else { await refetch(); }
              } catch (e) { console.error(e); }
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: po?.status !== "draft" ? 0.5 : 1 }}
          >
            <Text>Save Draft</Text>
          </Pressable>
        )}
        <Pressable
          disabled={!canSubmit}
          onPress={async () => {
            try {
              await submit(po?.id);
              toast("Submitted", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Submit failed", "error");
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canSubmit ? 1 : 0.5 }}
        >
          <Text>Submit</Text>
        </Pressable>
        <Pressable
          disabled={!canApprove}
          onPress={async () => {
            try {
              await approve(po?.id);
              toast("Approved", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Approve failed", "error");
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canApprove ? 1 : 0.5 }}
        >
          <Text>Approve</Text>
        </Pressable>
        {FEATURE_PO_QUICK_RECEIVE && po?.id && (
          <Pressable
            disabled={vendorGuardActive || !receivable}
            onPress={async () => { try { await receiveAll(po); await refetch(); } catch (e) { console.error(e); } }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: vendorGuardActive || !receivable ? 0.5 : 1 }}
          >
            <Text>Receive All</Text>
          </Pressable>
        )}
        <Pressable
          disabled={!canCancel}
          onPress={async () => {
            try {
              await cancel(po?.id);
              toast("Cancelled", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Cancel failed", "error");
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canCancel ? 1 : 0.5 }}
        >
          <Text>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canClose}
          onPress={async () => {
            try {
              await close(po?.id);
              toast("Closed", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              toast(e?.message || "Close failed", "error");
            }
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, opacity: canClose ? 1 : 0.5 }}
        >
          <Text>Close</Text>
        </Pressable>
      </View>

      <FlatList
        style={{ marginTop: 12 }}
        data={lines}
        keyExtractor={(l: any) => String(l.id ?? l.itemId)}
        renderItem={({ item: line }: any) => {
          const canReceive = receivable && !vendorGuardActive;
          return (
            <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
              <Text>Qty: {line.qty} {line.uom || "ea"}</Text>

              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {canReceive ? (
                  <Pressable
                    onPress={() => setModal({ open: true, lineId: line.id, itemId: line.itemId })}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 8 }}
                  >
                    <Text>Receive</Text>
                  </Pressable>
                ) : null}

                {/* Receive History chip */}
                <Pressable
                  onPress={() => setHistory({ open: true, itemId: line.itemId, lineId: line.id })}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 999 }}
                >
                  <Text>Receive History</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      {/* Minimal receive modal */}
      <Modal visible={modal.open} transparent animationType="slide" onRequestClose={() => setModal({ open: false })}>
        <View style={{ flex:1, backgroundColor:"rgba(0,0,0,0.5)", justifyContent:"flex-end" }}>
          <View style={{ backgroundColor:"#fff", padding:16, borderTopLeftRadius:12, borderTopRightRadius:12 }}>
            <Text style={{ fontSize:16, fontWeight:"700", marginBottom:8 }}>Receive Line</Text>
            <Text>Item: {modal.itemId}</Text>
            <View style={{ marginTop:8 }}>
              <Text>Qty</Text>
              <TextInput value={qty} onChangeText={setQty} keyboardType="numeric" style={{ borderWidth:1, borderRadius:8, padding:8 }} />
            </View>
            <View style={{ marginTop:8 }}>
              <Text>Lot (optional)</Text>
              <TextInput value={lot} onChangeText={setLot} style={{ borderWidth:1, borderRadius:8, padding:8 }} />
            </View>
            <View style={{ marginTop:8 }}>
              <Text>Location (optional)</Text>
              <TextInput value={locationId} onChangeText={setLocationId} style={{ borderWidth:1, borderRadius:8, padding:8 }} />
            </View>
            <View style={{ flexDirection:"row", justifyContent:"flex-end", gap:12, marginTop:12 }}>
              <Pressable onPress={() => setModal({ open:false })}><Text>Cancel</Text></Pressable>
              <Pressable onPress={onReceiveLine} style={{ paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderRadius:8 }}>
                <Text>Receive</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Receive History sheet */}
      {history.open && history.itemId && history.lineId && po?.id && (
        <ReceiveHistorySheet
          itemId={history.itemId}
          poId={po.id}
          lineId={history.lineId}
          visible={history.open}
          onClose={() => setHistory({ open: false })}
        />
      )}

      {/* Vendor Picker modal */}
      <Modal visible={vendorModalOpen} animationType="slide" onRequestClose={() => setVendorModalOpen(false)}>
        <PartySelectorModal
          role="vendor"
          onClose={() => setVendorModalOpen(false)}
          onSelect={async (p) => {
            try {
              if (!po?.id) return;
              await updateObject("purchaseOrder", po.id, { vendorId: p.id });
              (toast ?? (() => {}))("Vendor set", "success");
              await refetch();
            } catch (e: any) {
              console.error(e);
              (toast ?? (() => {}))(e?.message || "Failed to set vendor", "error");
            } finally {
              setVendorModalOpen(false);
            }
          }}
        />
      </Modal>
    </View>
  );
}
function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: bg, marginRight: 6 }}>
      <Text style={{ color: fg, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
function Btn({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!!disabled}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: t.colors.border,
        backgroundColor: disabled ? t.colors.border : t.colors.card,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <Text style={{ color: t.colors.text, fontWeight: "bold" as any }}>{label}</Text>
    </Pressable>
  );
}
