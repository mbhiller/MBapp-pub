// apps/mobile/src/screens/SalesOrderDetailScreen.tsx
import * as React from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useRoute, RouteProp } from "@react-navigation/native";
import {
  getSalesOrder,
  updateSalesOrder,
  createSalesOrder,
  submitSalesOrder,
  commitSalesOrder,
  reserveSalesOrder,
  fulfillSalesOrder,
  releaseSalesOrder,
  type LineDelta,
  type SalesOrder,
  type SalesOrderLine,
} from "../features/salesOrders/api";
import { ItemSelectorModal, type ItemSelection } from "../features/_shared/ItemSelectorModal";
import { CustomerSelectorModal, type CustomerSnapshot } from "../features/_shared/CustomerSelectorModal";
import { useColors } from "../features/_shared/useColors";
import { Feather } from "@expo/vector-icons";
import { makeKey, normalizeLines, toPatchLines, type WithKey } from "../features/_shared/lineEditor";


/* ---------- helpers ---------- */
type RootStackParamList = { SalesOrderDetail: { id?: string; mode?: "new" | "edit" } };
type ScreenRoute = RouteProp<RootStackParamList, "SalesOrderDetail">;
type WLine = WithKey<SalesOrderLine>;

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: bg, marginRight: 6 }}>
      <Text style={{ color: fg, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
function s<T>(v: T | null | undefined): T | undefined { return v == null ? undefined : v; }
function Chevron({ open }: { open: boolean }) { return <Text style={{ fontSize: 16 }}>{open ? "▾" : "▸"}</Text>; }
function lineItemLabel(ln: Partial<SalesOrderLine>): string | undefined {
  return (ln as any).itemName ?? (ln as any).productName ?? (ln as any).name ?? (ln as any).sku ?? (ln as any).code ?? (ln as any).label ?? undefined;
}
function isTempId(id?: string | null) { return !!id && String(id).startsWith("TMP_"); }


export default function SalesOrderDetailScreen() {
  const route = useRoute<ScreenRoute>();
  const navigation = useNavigation<any>();
  const soId = route.params?.id;
  const isNew = route.params?.mode === "new";

  const t = useColors();
  const scrollRef = React.useRef<ScrollView>(null);

  const [loading, setLoading] = React.useState<boolean>(!isNew);
  const [saving, setSaving] = React.useState(false);
  const [order, setOrder] = React.useState<SalesOrder | null>(null);

  // collapsible
  const [customerOpen, setCustomerOpen] = React.useState(false);
  const [orderOpen, setOrderOpen] = React.useState(true);

  // modes
  const [editMode, setEditMode] = React.useState(false);
  const [actionMode, setActionMode] = React.useState(false);

  // drafts (edit mode)
  const [draftLines, setDraftLines] = React.useState<WLine[]>([]);
  const [orderNotes, setOrderNotes] = React.useState<string>("");

  // Customer Modal
  const [customerModalOpen, setCustomerModalOpen] = React.useState<boolean>(Boolean(isNew));
  const [customerInitial, setCustomerInitial] = React.useState<{ id: string; label?: string } | null>(null);

  // Item modal
  const [itemModalOpen, setItemModalOpen] = React.useState(false);
  const addAfterLineIdRef = React.useRef<string | null>(null);
  const changeLineKeyRef = React.useRef<string | null>(null);
  const changeLineIndexRef = React.useRef<number | null>(null);

  // inline persist after creating brand-new order here
  const inlinePersistRef = React.useRef<boolean>(false);

  // pre-seed item modal
  const [modalInitialItem, setModalInitialItem] = React.useState<{ id: string; label?: string; type?: string } | null>(null);
  const [modalInitialQty, setModalInitialQty] = React.useState<number>(1);

  const hydrate = React.useCallback(async () => {
    if (!soId) return;
    setLoading(true);
    try {
      const soObj = await getSalesOrder(soId);
      setOrder(soObj);
      setDraftLines(normalizeLines(soObj?.lines));
      setOrderNotes(soObj?.notes || "");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load sales order");
    } finally { setLoading(false); }
  }, [soId]);

  React.useEffect(() => { if (!isNew && soId) hydrate(); }, [hydrate, isNew, soId]);

  // counters
  const reservedFor = React.useCallback((lineId: string) => Math.max(0, Number(order?.metadata?.reservedMap?.[lineId] ?? 0)), [order]);
  const fulfilledFor = React.useCallback((line: SalesOrderLine) => Math.max(0, Number(line?.qtyFulfilled ?? 0)), []);
  const backorderedFor = React.useCallback((line: SalesOrderLine) => Math.max(0, (line.qty ?? 0) - reservedFor(line.id) - fulfilledFor(line)), [reservedFor, fulfilledFor]);

  const totals = React.useMemo(() => {
    const src: SalesOrderLine[] = editMode ? draftLines : (order?.lines || []);
    let res = 0, ful = 0, back = 0;
    for (const ln of src) { res += reservedFor(ln.id); ful += fulfilledFor(ln); back += backorderedFor(ln); }
    return { reserved: res, fulfilled: ful, backordered: back, lines: src.length };
  }, [order, draftLines, editMode, reservedFor, fulfilledFor, backorderedFor]);

  // edit helpers
  function makeTmpId() { return `TMP_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
  function setLineQty(lineKey: string, qty: number) {
    setDraftLines((prev) => prev.map((l) => ((l as any)._key === lineKey ? { ...l, qty: Math.max(0, Math.floor(qty)) } : l)));
  }

  // apply
  async function applyLines(next: WLine[]) {
    if (!order) return;
    const shouldPersistNow = inlinePersistRef.current === true ? true : !editMode ? true : false;

    if (!shouldPersistNow) {
      setDraftLines(next);
      return;
    }

    const linesPatch = toPatchLines(next);
    try {
      const updated = await updateSalesOrder(order.id, { lines: linesPatch });
      const normalized = normalizeLines(updated?.lines);
      if (updated && updated.id) {
        setOrder(updated as any);
        setDraftLines(normalized);
      } else {
        await hydrate();
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save lines");
    }
  }

  async function addLineAfter(afterLineId: string | null, sel: ItemSelection) {
    if (!order) return;
    const base = [...draftLines];
    const idx = afterLineId ? base.findIndex((l) => l.id === afterLineId) : base.length - 1;
    const insertIdx = idx >= 0 ? idx + 1 : base.length;
    const newLine: WLine = { id: makeTmpId(), itemId: sel.itemId, qty: sel.qty, _key: makeKey(undefined) } as any;
    const next = base.slice();
    next.splice(insertIdx, 0, newLine);
    await applyLines(next);
    setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 80);
  }

  async function changeLineItem(lineKey: string, sel: ItemSelection) {
    if (!order) return;
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
      qty: typeof sel.qty === "number" && sel.qty > 0 ? sel.qty : (curr.qty ?? 1),
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
          if (!order) return;
          const base = [...draftLines];
          const next = base.filter((l) => (l as any)._key !== lineKey);
          await applyLines(next);
        },
      },
    ]);
  }

  // save/cancel edits
  async function onSaveEdits() {
    if (!order) return;
    setSaving(true);
    try {
      const linesPatch = toPatchLines(draftLines);
      const updated = await updateSalesOrder(order.id, { lines: linesPatch, notes: orderNotes });
      if (updated && updated.id) {
        setOrder(updated as any);
        setDraftLines(normalizeLines(updated.lines));
        setOrderNotes(updated.notes ?? "");
      } else {
        await hydrate();
      }
      setEditMode(false);
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save order changes");
    } finally { setSaving(false); }
  }
  function onCancelEdits() {
    if (!order) return;
    setDraftLines(normalizeLines(order.lines));
    setOrderNotes(order.notes || "");
    setEditMode(false);
  }

  // guards
  const isClosed = (s: string) => s === "canceled" || s === "closed" || s === "fulfilled";

  // order-level actions
  async function actionSubmit() { if (!order || isClosed(order.status)) return; try { await submitSalesOrder(order.id); await hydrate(); } catch {} }
  async function actionCommit(strict?: boolean) { if (!order || isClosed(order.status)) return; try { await commitSalesOrder(order.id, { strict: !!strict }); await hydrate(); } catch {} }
  async function actionReserveAll() {
    if (!order || isClosed(order.status)) return;
    try {
      const lines: LineDelta[] = (order.lines || [])
        .map((l) => {
          const need = Math.max(0, (l.qty ?? 0) - reservedFor(l.id) - fulfilledFor(l));
          return need > 0 ? { lineId: l.id, deltaQty: need } : null;
        })
        .filter(Boolean) as LineDelta[];
      if (lines.length) { await reserveSalesOrder(order.id, lines); await hydrate(); }
    } catch {}
  }
  async function actionFulfillAll() {
    if (!order || isClosed(order.status)) return;
    try {
      const lines: LineDelta[] = (order.lines || [])
        .map((l) => { const r = reservedFor(l.id); return r > 0 ? { lineId: l.id, deltaQty: r } : null; })
        .filter(Boolean) as LineDelta[];
      if (lines.length) { await fulfillSalesOrder(order.id, lines); await hydrate(); }
    } catch {}
  }
  async function actionReleaseAll() {
    if (!order || isClosed(order.status)) return;
    try {
      const lines: LineDelta[] = (order.lines || [])
        .map((l) => {
          const r = reservedFor(l.id);
          const need = Math.max(0, (l.qty ?? 0) - fulfilledFor(l));
          const extra = Math.max(0, r - need);
          return extra > 0 ? { lineId: l.id, deltaQty: extra } : null;
        })
        .filter(Boolean) as LineDelta[];
      if (lines.length) { await releaseSalesOrder(order.id, lines); await hydrate(); }
    } catch {}
  }

  // per-line actions (outside edit)
  async function reserveOne(line: SalesOrderLine) {
    if (!order || isClosed(order.status)) return;
    const need = Math.max(0, (line.qty ?? 0) - reservedFor(line.id) - fulfilledFor(line));
    if (need <= 0) return;
    try { await reserveSalesOrder(order.id, [{ lineId: line.id, deltaQty: 1 }]); await hydrate(); } catch {}
  }
  async function fulfillOne(line: SalesOrderLine) {
    if (!order || isClosed(order.status)) return;
    const r = reservedFor(line.id);
    if (r <= 0) return;
    try { await fulfillSalesOrder(order.id, [{ lineId: line.id, deltaQty: 1 }]); await hydrate(); } catch {}
  }
  async function releaseOne(line: SalesOrderLine) {
    if (!order || isClosed(order.status)) return;
    const r = reservedFor(line.id);
    const need = Math.max(0, (line.qty ?? 0) - fulfilledFor(line));
    const extra = Math.max(0, r - need);
    if (extra <= 0) return;
    try { await releaseSalesOrder(order.id, [{ lineId: line.id, deltaQty: 1 }]); await hydrate(); } catch {}
  }

  // badge colors
  const reservedBg = (t.colors as any).badgeReservedBg ?? "#EEF2FF";
  const reservedFg = (t.colors as any).badgeReservedFg ?? "#3730A3";
  const fulfilledBg = (t.colors as any).badgeFulfilledBg ?? "#ECFDF5";
  const fulfilledFg = (t.colors as any).badgeFulfilledFg ?? "#065F46";
  const backBg = (t.colors as any).badgeBackorderedBg ?? "#FEF3C7";
  const backFg = (t.colors as any).badgeBackorderedFg ?? "#92400E";

  // new-mode: prompt for customer; create order on save
  const handleCustomerSave = React.useCallback(
    async (snap: CustomerSnapshot) => {
      try {
        if (!order && isNew) {
          const created = await createSalesOrder({
            customerId: snap.customerId!,
            customerName: s(snap.customerName),
            customerEmail: s(snap.customerEmail),
            customerPhone: s(snap.customerPhone),
            customerAltPhone: s(snap.customerAltPhone),
            billingAddress: s(snap.billingAddress),
            shippingAddress: s(snap.shippingAddress),
            customerNotes: s(snap.customerNotes),
          });
          inlinePersistRef.current = true;
          setOrder(created);
          setDraftLines(normalizeLines(created.lines));
          setOrderNotes(created.notes ?? "");
          setCustomerOpen(true);
          setEditMode(true);
        } else if (order) {
          const patch = {
            customerId: snap.customerId!,
            customerName: s(snap.customerName),
            customerEmail: s(snap.customerEmail),
            customerPhone: s(snap.customerPhone),
            customerAltPhone: s(snap.customerAltPhone),
            billingAddress: s(snap.billingAddress),
            shippingAddress: s(snap.shippingAddress),
            customerNotes: s(snap.customerNotes ?? order.customerNotes),
          };
          const updated = await updateSalesOrder(order.id, patch);
          if (updated && updated.id) { setOrder(updated as any); }
          setCustomerOpen(true);
        }
      } catch (e: any) {
        Alert.alert("Save failed", e?.message ?? "Could not save customer");
      } finally { setCustomerModalOpen(false); }
    },
    [isNew, order]
  );

  if (loading) {
    return (<View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}><ActivityIndicator /></View>);
  }
  if (!order && !isNew) {
    return (<View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}><Text style={{ color: t.colors.text }}>Order not found</Text></View>);
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
          {/* header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Text style={{ color: t.colors.text, fontSize: 20, fontWeight: "700" as any }}>Sales Order</Text>
              {order ? (
                <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>
                  {(order.orderNumber ? `#${order.orderNumber}` : order.id)} · Status: {order.status}
                </Text>
              ) : (<Text style={{ color: t.colors.textMuted, marginTop: 2 }}>New · Status: draft</Text>)}
            </View>
          </View>

          {/* Customer Details */}
          <Card
            title="Customer Details"
            open={customerOpen}
            onToggle={() => setCustomerOpen((o) => !o)}
            subtitle={!customerOpen ? `${order?.customerName || "—"}${order?.customerEmail ? ` · ${order?.customerEmail}` : order?.customerPhone ? ` · ${order?.customerPhone}` : ""}` : undefined}
            headerExtra={
              (order?.status ?? "draft") === "draft" ? (
                <View style={{ marginRight: 25 }}>
                  <Pressable
                    onPress={() => {
                      setCustomerInitial({
                        id: String(order?.customerId ?? ""),
                        label: order?.customerName || undefined,
                      });
                      setCustomerModalOpen(true);
                    }}
                    hitSlop={10}
                    style={{ padding: 6, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}
                  >
                    <Feather name="edit-2" size={16} color={t.colors.text} />
                  </Pressable>
                </View>
              ) : null
            }
          >
            <Row label="Name" value={order?.customerName} />
            <Row label="Email" value={order?.customerEmail} />
            <Row label="Phone" value={order?.customerPhone} />
            <Row label="Alt Phone" value={order?.customerAltPhone} />
            <Row label="Billing Address" value={order?.billingAddress} />
            <Row label="Shipping Address" value={order?.shippingAddress} />
            <Row label="Customer Notes" value={order?.customerNotes} multiline />
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Customer details are managed in the Customer module.</Text>
          </Card>

          {/* Order Details */}
          <Card
            title="Order Details"
            open={orderOpen}
            onToggle={() => setOrderOpen((o) => !o)}
            subtitle={`${order?.status || "draft"} · ${(editMode ? draftLines : order?.lines)?.length || 0} lines`}
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
                    if (!order) return;
                    if (v) { setEditMode(true); return; }
                    await onSaveEdits();
                  }}
                />
              </View>
            </View>

            {/* badges */}
            <View style={{ flexDirection: "row", marginTop: 4, marginBottom: 8 }}>
              <Pill label={`Reserved ${totals.reserved}`} bg={reservedBg} fg={reservedFg} />
              <Pill label={`Fulfilled ${totals.fulfilled}`} bg={fulfilledBg} fg={fulfilledFg} />
              <Pill label={`Backordered ${totals.backordered}`} bg={backBg} fg={backFg} />
            </View>

            {/* notes */}
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontWeight: "600" as any, marginBottom: 6, color: t.colors.text }}>Order Notes</Text>
              <TextInput
                value={orderNotes}
                onChangeText={setOrderNotes}
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

            {/* header: + Add Line (edit-mode only) */}
            {editMode ? (
              <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10 }}>
                <Pressable
                  onPress={() => {
                    addAfterLineIdRef.current = (draftLines[draftLines.length - 1]?.id ?? null);
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
              {(editMode ? draftLines : (order?.lines || [])).map((ln: any, index: number) => {
                const r = reservedFor(ln.id);
                const f = fulfilledFor(ln);
                const b = Math.max(0, (ln.qty ?? 0) - r - f);
                const canReserve1 = !editMode && order && !isClosed(order.status) && ln.qty - r - f > 0;
                const canFulfill1 = !editMode && order && !isClosed(order.status) && r > 0;
                const need = Math.max(0, (ln.qty ?? 0) - f);
                const extra = Math.max(0, r - need);
                const canRelease1 = !editMode && order && !isClosed(order.status) && extra > 0;
                const key = editMode ? (ln._key ?? `${ln.id || ln.itemId || "idx"}:${index}`) : `${ln.id || ln.itemId || "idx"}:${index}`;
                const label = lineItemLabel(ln) ?? ln.itemId ?? "(select item)";

                return (
                  <View key={key} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
                    <Text style={{ color: t.colors.text, fontWeight: "600" as any }} numberOfLines={1}>{label}</Text>

                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                      <Text style={{ color: t.colors.textMuted, marginRight: 8 }}>Qty</Text>
                      <TextInput
                        editable={editMode}
                        keyboardType="number-pad"
                        value={String(ln.qty ?? 0)}
                        onChangeText={(s) => setLineQty(editMode ? ln._key : ln.id, Number(s || 0))}
                        style={{
                          width: 64,
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          borderWidth: 1,
                          borderColor: t.colors.border,
                          borderRadius: 8,
                          color: t.colors.text,
                          backgroundColor: (t.colors as any).inputBg ?? t.colors.card,
                        }}
                      />

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
                            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}
                            accessibilityLabel="Change item"
                          >
                            <Feather name="edit-2" size={16} color={t.colors.text} />
                          </Pressable>

                          <Pressable
                            onPress={() => removeLineWithConfirm(ln._key ?? ln.id)}
                            hitSlop={10}
                            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}
                            accessibilityLabel="Remove line"
                          >
                            <Feather name="minus" size={16} color={t.colors.text} />
                          </Pressable>
                        </View>
                      ) : null}

                      <View style={{ flexDirection: "row", marginLeft: "auto" }}>
                        <Pill label={`Rsv ${r}`} bg={reservedBg} fg={reservedFg} />
                        <Pill label={`Ful ${f}`} bg={fulfilledBg} fg={fulfilledFg} />
                        <Pill label={`BO ${b}`} bg={backBg} fg={backFg} />
                      </View>
                    </View>

                    {!editMode && actionMode ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <Btn onPress={() => reserveOne(ln)} disabled={!canReserve1} label="Reserve 1" />
                        <Btn onPress={() => fulfillOne(ln)} disabled={!canFulfill1} label="Fulfill 1" />
                        <Btn onPress={() => releaseOne(ln)} disabled={!canRelease1} label="Release 1" />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Save/Cancel */}
            {editMode ? (
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <Pressable onPress={onCancelEdits} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}>
                  <Text style={{ color: t.colors.text }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={onSaveEdits} disabled={saving} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: saving ? t.colors.border : t.colors.primary }}>
                  <Text style={{ color: (t.colors as any).primaryText ?? "#ffffff", fontWeight: "bold" as any }}>
                    {saving ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Card>

          {/* Actions */}
          {!editMode && order ? (
            <Card title="Actions" open={true} onToggle={() => {}}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                <Btn onPress={() => actionCommit(true)} label="Commit (strict)" />
                <Btn onPress={actionReserveAll} label="Reserve All" />
                <Btn onPress={actionFulfillAll} label="Fulfill All" />
                <Btn onPress={actionReleaseAll} label="Release Excess" />
                <Btn onPress={hydrate} label="Refresh" />
                <Btn onPress={actionSubmit} label="Submit" />
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Customer Modal */}
      <CustomerSelectorModal
        visible={customerModalOpen}
        onClose={() => {
          if (isNew && !order) { navigation.goBack(); return; }
          setCustomerModalOpen(false);
          setCustomerInitial(null);
        }}
        onSave={handleCustomerSave}
        initialCustomer={customerInitial ?? undefined}
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
function Card({ title, subtitle, open, onToggle, headerExtra, children }: { title: string; subtitle?: string; open: boolean; onToggle: () => void; headerExtra?: React.ReactNode; children: React.ReactNode; }) {
  const t = useColors();
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 12, backgroundColor: t.colors.card }}>
      <Pressable onPress={onToggle} style={{ padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.colors.text, fontWeight: "700" as any }}>{title}</Text>
          {subtitle ? <Text style={{ color: t.colors.textMuted, marginTop: 2 }}>{subtitle}</Text> : null}
        </View>
        {headerExtra ? <View style={{ marginLeft: 8 }}>{headerExtra}</View> : null}
        <Chevron open={open} />
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
function Btn({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!!disabled}
      style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: disabled ? t.colors.border : t.colors.card, opacity: disabled ? 0.7 : 1 }}
    >
      <Text style={{ color: t.colors.text, fontWeight: "bold" as any }}>{label}</Text>
    </Pressable>
  );
}
