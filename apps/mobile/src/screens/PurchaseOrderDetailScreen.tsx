// apps/mobile/src/screens/PurchaseOrderDetailScreen.tsx
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { Feather } from "@expo/vector-icons";

import {
  CustomerSelectorModal,
  type CustomerSnapshot,
} from "../features/_shared/CustomerSelectorModal";
import {
  ItemSelectorModal,
  type ItemSelection,
} from "../features/_shared/ItemSelectorModal";

import {
  getPO,
  createPO,
  updatePO,
  submitPO,
  approvePO,
  receivePO,
  cancelPO,
  closePO,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "../features/purchaseOrders/api";

/* ---------- helpers ---------- */
type RootStackParamList = { PurchaseOrderDetail: { id?: string; mode?: "new" | "edit" } };
type ScreenRoute = RouteProp<RootStackParamList, "PurchaseOrderDetail">;

function isTempId(id?: string | null) { return !!id && String(id).startsWith("TMP_"); }
function s(v?: string | null) { return v == null ? undefined : v; }

// ---- Stable key helpers ----
type WithKey<T> = T & { _key: string };
type WLine = WithKey<PurchaseOrderLine>;

function makeKey(id?: string) {
  return id && typeof id === "string" ? id : `CID_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeLines<T extends { id?: string; itemId: string; qty?: number; note?: string; qtyReceived?: number }>(
  lines: T[] | undefined | null
): Array<WithKey<Required<T>>> {
  const src = Array.isArray(lines) ? lines : [];
  return src.map((ln) => {
    const qty = typeof ln.qty === "number" && !Number.isNaN(ln.qty) ? ln.qty : 1;
    const qtyReceived = typeof (ln as any).qtyReceived === "number" ? (ln as any).qtyReceived : 0;
    const _key = makeKey(ln.id);
    return { ...ln, qty, qtyReceived, _key } as WithKey<Required<T>>;
  });
}
function toPatchLines<T extends { id?: string; itemId: string; qty: number; note?: string }>(lines: Array<WithKey<T>>) {
  return lines.map((l) => {
    const id = typeof l.id === "string" && !/^TMP_|^CID_/.test(l.id) ? l.id : undefined;
    return { id, itemId: l.itemId, qty: Number(l.qty) || 1, note: l.note };
  });
}

export default function PurchaseOrderDetailScreen() {
  const route = useRoute<ScreenRoute>();
  const navigation = useNavigation<any>();
  const poId = route.params?.id;
  const isNew = route.params?.mode === "new";

  const t = useColors();
  const scrollRef = React.useRef<ScrollView>(null);

  const [loading, setLoading] = React.useState<boolean>(!isNew);
  const [saving, setSaving] = React.useState(false);
  const [po, setPO] = React.useState<PurchaseOrder | null>(null);

  const [vendorOpen, setVendorOpen] = React.useState(true);
  const [orderOpen, setOrderOpen] = React.useState(true);

  const [editMode, setEditMode] = React.useState(false);
  const [actionMode, setActionMode] = React.useState(false);

  const [draftLines, setDraftLines] = React.useState<WLine[]>([]);
  const [notes, setNotes] = React.useState<string>("");

  const [modalInitialItem, setModalInitialItem] =
    React.useState<{ id: string; label?: string; type?: string } | null>(null);

  const [vendorInitial, setVendorInitial] =
    React.useState<{ id: string; label?: string } | null>(null);
  const [modalInitialQty, setModalInitialQty] = React.useState<number>(1);
  const [vendorModalOpen, setVendorModalOpen] = React.useState<boolean>(Boolean(isNew));
  const [itemModalOpen, setItemModalOpen] = React.useState(false);

  const addAfterLineIdRef = React.useRef<string | null>(null);
  const changeLineKeyRef = React.useRef<string | null>(null);
  const changeLineIndexRef = React.useRef<number | null>(null);
  const inlinePersistRef = React.useRef<boolean>(false);

  const hydrate = React.useCallback(async () => {
    if (!poId) return;
    setLoading(true);
    try {
      const rec = await getPO(poId);
      setPO(rec);
      setDraftLines(normalizeLines(rec?.lines));
      setNotes(rec?.notes ?? "");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load purchase order");
    } finally { setLoading(false); }
  }, [poId]);

  React.useEffect(() => { if (!isNew && poId) hydrate(); }, [hydrate, isNew, poId]);

  // badge colors
  const recvBg = (t.colors as any).badgeFulfilledBg ?? "#ECFDF5";
  const recvFg = (t.colors as any).badgeFulfilledFg ?? "#065F46";

  // line helpers
  function makeTmpId() { return `TMP_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
  function setLineQtyOrdered(lineKey: string, qty: number) {
    setDraftLines((prev) => prev.map((l) => ((l as any)._key === lineKey ? { ...l, qty: Math.max(0, Math.floor(qty)) } : l)));
  }

  async function applyLines(next: WLine[]) {
    if (!po) return;
    const shouldPersist = inlinePersistRef.current === true ? true : !editMode ? true : false;
    if (!shouldPersist) { setDraftLines(next); return; }

    const linesPatch = toPatchLines(next);
    try {
      const updated = await updatePO(String(po.id), { lines: linesPatch, notes } as any);
      const normalized = normalizeLines(updated?.lines);
      if (updated?.id) {
        setPO(updated as any);
        setDraftLines(normalized);
        setNotes(updated.notes ?? "");
      } else {
        await hydrate();
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save lines");
    }
  }

  async function addLineAfter(afterLineId: string | null, sel: ItemSelection) {
    if (!po) return;
    const base = [...draftLines];
    const idx = afterLineId ? base.findIndex((l) => l.id === afterLineId) : base.length - 1;
    const insertIdx = idx >= 0 ? idx + 1 : base.length;

    const newLine: WLine = { id: makeTmpId(), itemId: sel.itemId, qty: sel.qty, qtyReceived: 0, _key: makeKey(undefined) } as any;
    const next = base.slice();
    next.splice(insertIdx, 0, newLine);
    await applyLines(next);
    setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 80);
  }

  async function changeLineItem(lineKey: string, sel: ItemSelection) {
    if (!po) return;
    const base = [...draftLines];
    const idxByKey = base.findIndex((l) => (l as any)._key === lineKey || l.id === lineKey);
    let idx = idxByKey >= 0 ? idxByKey : (changeLineIndexRef.current ?? -1);
    if (idx < 0 || idx >= base.length) return;

    const curr = base[idx];
    const next = base.slice();
    next[idx] = {
      ...(curr as any),
      id: curr.id,
      _key: (curr as any)._key,
      itemId: sel.itemId,
      qty: typeof sel.qty === "number" && sel.qty > 0 ? sel.qty : ((curr as any).qty ?? 1),
    } as any;

    await applyLines(next);
  }

  async function removeLineWithConfirm(lineKey: string) {
    Alert.alert("Remove line", "Are you sure you want to remove this line?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (!po) return;
          const base = [...draftLines];
          const next = base.filter((l) => (l as any)._key !== lineKey);
          await applyLines(next);
        },
      },
    ]);
  }

  // save/cancel
  async function onSaveEdits() {
    if (!po) return;
    setSaving(true);
    try {
      const linesPatch = toPatchLines(draftLines);
      const updated = await updatePO(String(po.id), { lines: linesPatch, notes } as any);
      if (updated?.id) {
        setPO(updated as any);
        setDraftLines(normalizeLines(updated.lines));
        setNotes(updated.notes ?? "");
      } else {
        await hydrate();
      }
      setEditMode(false);
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save PO");
    } finally { setSaving(false); }
  }
  function onCancelEdits() {
    if (!po) return;
    setDraftLines(normalizeLines(po.lines));
    setNotes(po.notes || "");
    setEditMode(false);
  }

  // Vendor save
  const handleVendorSave = React.useCallback(
    async (snap: CustomerSnapshot) => {
      try {
        if (!po && isNew) {
          const created = await createPO({
            vendorId: snap.customerId,
            vendorName: s(snap.customerName),
            vendorEmail: s(snap.customerEmail),
            vendorPhone: s(snap.customerPhone),
            vendorAltPhone: s(snap.customerAltPhone),
            billingAddress: s(snap.billingAddress),
            shippingAddress: s(snap.shippingAddress),
            notes: s(snap.customerNotes),
            status: "draft",
            lines: [],
          });
          inlinePersistRef.current = true;
          setPO(created);
          setDraftLines(normalizeLines(created.lines));
          setNotes(created.notes ?? "");
          setVendorOpen(true);
          setEditMode(true);
        } else if (po) {
          const patch = {
            vendorId: snap.customerId,
            vendorName: s(snap.customerName),
            vendorEmail: s(snap.customerEmail),
            vendorPhone: s(snap.customerPhone),
            vendorAltPhone: s(snap.customerAltPhone),
            billingAddress: s(snap.billingAddress),
            shippingAddress: s(snap.shippingAddress),
            notes: s(snap.customerNotes ?? po.notes),
          };
          const updated = await updatePO(String(po.id), patch as any);
          if (updated?.id) setPO(updated as any);
          setVendorOpen(true);
        }
      } catch (e: any) {
        Alert.alert("Save failed", e?.message ?? "Could not save vendor");
      } finally {
        setVendorModalOpen(false);
      }
    },
    [isNew, po]
  );

  // Actions
  async function actionSubmit() { if (!po) return; try { await submitPO(String(po.id)); await hydrate(); } catch {} }
  async function actionApprove() { if (!po) return; try { await approvePO(String(po.id)); await hydrate(); } catch {} }
  async function actionCancel() { if (!po) return; try { await cancelPO(String(po.id)); await hydrate(); } catch {} }
  async function actionClose() { if (!po) return; try { await closePO(String(po.id)); await hydrate(); } catch {} }

  async function receiveOne(line: PurchaseOrderLine) {
    if (!po || !line?.id) return;
    const ordered = Math.max(0, Number(line.qty ?? 0));
    const received = Math.max(0, Number(line.qtyReceived ?? 0));
    if (received >= ordered) return;
    try { await receivePO(String(po.id), [{ lineId: String(line.id), deltaQty: 1 }]); await hydrate(); } catch {}
  }
  async function receiveAll() {
    if (!po) return;
    const src = (po.lines || []) as PurchaseOrderLine[];
    const lines = src
      .map((l) => {
        const ordered = Math.max(0, Number(l.qty ?? 0));
        const received = Math.max(0, Number(l.qtyReceived ?? 0));
        const need = Math.max(0, ordered - received);
        return need > 0 ? { lineId: String(l.id), deltaQty: need } : null;
      })
      .filter(Boolean) as { lineId: string; deltaQty: number }[];
    if (!lines.length) return;
    try { await receivePO(String(po.id), lines); await hydrate(); } catch {}
  }

  if (loading) {
    return (<View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}><ActivityIndicator /></View>);
  }
  if (!po && !isNew) {
    return (<View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}><Text style={{ color: t.colors.text }}>Purchase order not found</Text></View>);
  }

  return (
    <>
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, backgroundColor: t.colors.bg }}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Text style={{ color: t.colors.text, fontSize: 20, fontWeight: "700" as any }}>Purchase Order</Text>
              {po ? (
                <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>
                  {(po.poNumber ? `#${po.poNumber}` : po.id)} · Status: {po.status}
                </Text>
              ) : (
                <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>New · Status: draft</Text>
              )}
            </View>
          </View>

          {/* Vendor */}
          <Card
            title="Vendor Details"
            open={vendorOpen}
            onToggle={() => setVendorOpen((o) => !o)}
            subtitle={!vendorOpen ? `${po?.vendorName || "—"}${po?.vendorEmail ? ` · ${po.vendorEmail}` : po?.vendorPhone ? ` · ${po.vendorPhone}` : ""}` : undefined}
            headerExtra={(po?.status ?? "draft") === "draft" ? (
              <View style={{ marginRight: 25 }}>
                <Pressable
                  onPress={() => {
                    setVendorInitial({
                      id: String(po?.vendorId ?? ""),
                      label: po?.vendorName || undefined,
                    });
                    setVendorModalOpen(true);
                  }}
                  hitSlop={10}
                  style={{ padding: 6, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}
                >
                  <Feather name="edit-2" size={16} color={t.colors.text} />
                </Pressable>
              </View>
            ) : null}
          >
            <Row label="Name" value={po?.vendorName} />
            <Row label="Email" value={po?.vendorEmail} />
            <Row label="Phone" value={po?.vendorPhone} />
            <Row label="Alt Phone" value={po?.vendorAltPhone} />
            <Row label="Billing Address" value={po?.billingAddress} />
            <Row label="Shipping Address" value={po?.shippingAddress} />
          </Card>

          {/* Order Details */}
          <Card
            title="Order Details"
            open={orderOpen}
            onToggle={() => setOrderOpen((o) => !o)}
            subtitle={`${po?.status || "draft"} · ${(editMode ? draftLines : po?.lines)?.length || 0} lines`}
          >
            {/* toggles */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 4, marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: t.colors.textMuted }}>Action Mode</Text>
                <Switch value={actionMode} onValueChange={setActionMode} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: t.colors.textMuted }}>Edit Mode</Text>
                <Switch
                  value={editMode}
                  onValueChange={async (v) => {
                    if (!po) return;
                    if (v) { setEditMode(true); return; }
                    await onSaveEdits();
                  }}
                />
              </View>
            </View>

            {/* notes */}
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontWeight: "600" as any, marginBottom: 6, color: t.colors.text }}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                editable={editMode}
                placeholder="Add notes…"
                placeholderTextColor={t.colors.textMuted}
                multiline
                style={{
                  minHeight: 48,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  borderRadius: 8,
                  padding: 8,
                  color: t.colors.text,
                  backgroundColor: (t.colors as any).inputBg ?? t.colors.card,
                }}
              />
            </View>

            {/* header: + Add Line */}
            {editMode ? (
              <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10 }}>
                <Pressable
                  onPress={() => {
                    addAfterLineIdRef.current = (draftLines[draftLines.length - 1]?.id ?? null) as any;
                    changeLineKeyRef.current = null;
                    setModalInitialItem(null);
                    setModalInitialQty(1);
                    setItemModalOpen(true);
                  }}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: t.colors.border,
                    backgroundColor: t.colors.card,
                  }}
                >
                  <Text style={{ color: t.colors.text }}>+ Add Line</Text>
                </Pressable>
              </View>
            ) : null}

            {/* lines */}
            <View>
              {(editMode ? draftLines : po?.lines || []).map((ln: any, index: number) => {
                const key = editMode ? (ln._key ?? `${ln.id || ln.itemId || "idx"}:${index}`) : `${ln.id || ln.itemId || "idx"}:${index}`;
                const ordered = Math.max(0, Number(ln.qty ?? 0));
                const received = Math.max(0, Number(ln.qtyReceived ?? 0));
                const canReceive1 =
                  !editMode &&
                  po &&
                  !["cancelled","canceled","closed","received"].includes(String(po.status ?? "").toLowerCase()) &&
                  received < ordered;
                const label = (ln as any).itemName ?? (ln as any).productName ?? (ln as any).label ?? ln.itemId ?? "(select item)";

                return (
                  <View key={key} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
                    <Text style={{ color: t.colors.text, fontWeight: "600" as any }} numberOfLines={1}>{label}</Text>

                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                      <Text style={{ color: t.colors.textMuted, marginRight: 8 }}>Ordered</Text>
                      <TextInput
                        editable={editMode}
                        keyboardType="number-pad"
                        value={String(ln.qty ?? 0)}
                        onChangeText={(s) => setLineQtyOrdered(editMode ? ln._key : ln.id, Number(s || 0))}
                        style={{
                          width: 72,
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          borderWidth: 1,
                          borderColor: t.colors.border,
                          borderRadius: 8,
                          color: t.colors.text,
                          backgroundColor: (t.colors as any).inputBg ?? t.colors.card,
                        }}
                      />

                      {/* edit-mode icons */}
                      {editMode ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 10 }}>
                          <Pressable
                            onPress={() => {
                              changeLineKeyRef.current = ln._key ?? ln.id ?? null;
                              changeLineIndexRef.current = index;
                              addAfterLineIdRef.current = null;
                              setModalInitialItem({ id: String(ln.itemId ?? ""), label });
                              setModalInitialQty(Math.max(1, Math.floor(Number(ln.qty ?? 1))));
                              setItemModalOpen(true);
                            }}
                            hitSlop={10}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: t.colors.border,
                              backgroundColor: t.colors.card,
                            }}
                            accessibilityLabel="Change item"
                          >
                            <Feather name="edit-2" size={16} color={t.colors.text} />
                          </Pressable>

                          <Pressable
                            onPress={() => removeLineWithConfirm(ln._key ?? ln.id)}
                            hitSlop={10}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: t.colors.border,
                              backgroundColor: t.colors.card,
                            }}
                            accessibilityLabel="Remove line"
                          >
                            <Feather name="minus" size={16} color={t.colors.text} />
                          </Pressable>
                        </View>
                      ) : null}

                      <View style={{ flexDirection: "row", marginLeft: "auto" }}>
                        <Pill label={`Rec ${received}/${ordered}`} bg={recvBg} fg={recvFg} />
                      </View>
                    </View>

                    {/* per-line receive (action mode) */}
                    {!editMode && actionMode ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <Btn onPress={() => receiveOne(ln)} disabled={!canReceive1} label="Receive 1" />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Save/Cancel */}
            {editMode ? (
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <Pressable
                  onPress={onCancelEdits}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}
                >
                  <Text style={{ color: t.colors.text }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={onSaveEdits}
                  disabled={saving}
                  style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: saving ? t.colors.border : t.colors.primary }}
                >
                  <Text style={{ color: (t.colors as any).primaryText ?? "#ffffff", fontWeight: "bold" as any }}>
                    {saving ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Card>

          {/* Actions */}
          {!editMode && po ? (
            <Card title="Actions" open={true} onToggle={() => {}}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                <Btn onPress={actionSubmit} label="Submit" />
                <Btn onPress={actionApprove} label="Approve" />
                <Btn onPress={receiveAll} label="Receive All" />
                <Btn onPress={actionCancel} label="Cancel" />
                <Btn onPress={actionClose} label="Close" />
                <Btn onPress={hydrate} label="Refresh" />
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Vendor Modal */}
      <CustomerSelectorModal
        visible={vendorModalOpen}
        onClose={() => {
          if (isNew && !po) { navigation.goBack(); return; }
          setVendorModalOpen(false);
          setVendorInitial(null);
        }}
        onSave={handleVendorSave}
        title="Select Vendor"
        candidateTypes={["vendor", "organization", "supplier", "contact", "person"]}
        initialCustomer={vendorInitial ?? undefined}
      />

      {/* Item Selector Modal */}
      <ItemSelectorModal
        visible={itemModalOpen}
        onClose={() => {
          setItemModalOpen(false);
          addAfterLineIdRef.current = null;
          changeLineKeyRef.current = null;
          changeLineIndexRef.current = null;
          setModalInitialItem(null);
        }}
        onSave={async (sel) => {
          const toChangeKey = changeLineKeyRef.current;
          const toAddAfter = addAfterLineIdRef.current;
          if (toChangeKey) { await changeLineItem(toChangeKey, sel); }
          else { await addLineAfter(toAddAfter, sel); }
          setItemModalOpen(false);
          addAfterLineIdRef.current = null;
          changeLineKeyRef.current = null;
          changeLineIndexRef.current = null;
          setModalInitialItem(null);
        }}
        title={changeLineKeyRef.current ? "Change Item" : "Select Item"}
        initialItem={modalInitialItem ?? undefined}
        initialQty={modalInitialQty}
      />
    </>
  );
}

/* --- Shared UI bits --- */
function Card({ title, subtitle, open, onToggle, headerExtra, children }:{
  title: string; subtitle?: string; open: boolean; onToggle: () => void; headerExtra?: React.ReactNode; children: React.ReactNode;
}) {
  const t = useColors();
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 12, backgroundColor: t.colors.card }}>
      <Pressable onPress={onToggle} style={{ padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.colors.text, fontWeight: "700" as any }}>{title}</Text>
          {subtitle ? <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>{subtitle}</Text> : null}
        </View>
        <Text style={{ fontSize: 16 }}>{open ? "▾" : "▸"}</Text>
        {headerExtra ? <View style={{ marginLeft: 8 }}>{headerExtra}</View> : null}
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>{children}</View> : null}
    </View>
  );
}
function Row({ label, value, multiline }: { label: string; value?: string | null; multiline?: boolean; }) {
  const t = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: t.colors.text, fontSize: 14 }} numberOfLines={multiline ? undefined : 1}>{value || "—"}</Text>
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
  const t = useColors();
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
