// List "open" BackorderRequest rows with bulk Ignore/Convert, vendor filter, and drill to created POs.
import * as React from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, TextInput, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useObjectsList } from "../features/_shared/useObjectsList";
import { apiClient } from "../api/client";
import DraftChooserModal, { PurchaseOrderDraft as Draft } from "../features/purchaseOrders/DraftChooserModal";

type Row = { id: string; itemId: string; qty: number; status: string; preferredVendorId?: string | null };

export default function BackordersListScreen() {
  const nav = useNavigation<any>();
  const [vendorFilter, setVendorFilter] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [chooserDrafts, setChooserDrafts] = React.useState<Draft[]>([]);
  const query = useObjectsList<Row>({ type: "backorderRequest", q: "open" });
  const items = (query.data?.pages ?? []).flatMap((p: any) => p.items ?? []) as Row[];

  const filtered = vendorFilter.trim()
    ? items.filter((r) => (r as any)?.preferredVendorId === vendorFilter.trim())
    : items;

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function bulk(action: "ignore" | "convert") {
    const picks = Object.keys(selected).filter((k) => selected[k]);
    if (picks.length === 0) return;
    for (const id of picks) {
      await apiClient.post(`/objects/backorderRequest/${encodeURIComponent(id)}:${action}`, {});
    }
    await query.refetchStable();

    // If converting and vendor filter is set, offer suggest-po and drill to drafts.
    if (action === "convert") {
      try {
        const reqs = picks.map((id) => ({ backorderRequestId: id }));
        const res = (await apiClient.post(`/purchasing/suggest-po`, {
          requests: reqs,
          vendorId: vendorFilter || null,
        })) as unknown as Response;
        const j: any = await (res as any).json();
        const drafts: Draft[] = Array.isArray(j?.drafts) ? j.drafts : (j?.draft ? [j.draft] : []);
        if (drafts.length === 1) {
          nav.navigate("PurchaseOrderDetail", { id: drafts[0].id, mode: "draft" });
        } else if (drafts.length > 1) {
          setChooserDrafts(drafts);
          setChooserOpen(true);
        }
      } catch (e) {
        Alert.alert("Draft creation", "Converted backorders; failed to open draft(s).");
      }
    }
    setSelected({});
  }

  if (query.isLoading) return <ActivityIndicator />;

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <DraftChooserModal
        visible={chooserOpen}
        drafts={chooserDrafts}
        onPick={(d) => {
          setChooserOpen(false);
          nav.navigate("PurchaseOrderDetail", { id: d.id, mode: "draft" });
        }}
        onClose={() => setChooserOpen(false)}
      />
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Backorders</Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Text>Vendor:</Text>
        <TextInput
          value={vendorFilter}
          onChangeText={setVendorFilter}
          placeholder="vendorId (optional)"
          style={{ flex: 1, borderWidth: 1, borderRadius: 6, padding: 8 }}
        />
        <Pressable onPress={() => bulk("ignore")} style={{ padding: 8, borderWidth: 1, borderRadius: 6 }}>
          <Text>Ignore Selected</Text>
        </Pressable>
        <Pressable onPress={() => bulk("convert")} style={{ padding: 8, borderWidth: 1, borderRadius: 6 }}>
          <Text>Convert Selected</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => toggle(item.id)}
            style={{
              padding: 12,
              borderWidth: 1,
              borderRadius: 8,
              marginBottom: 8,
              backgroundColor: selected[item.id] ? "#00000010" : "transparent",
            }}
          >
            <Text style={{ fontWeight: "600" }}>{item.itemId}</Text>
            <Text>Qty: {item.qty} • Status: {item.status}</Text>
            {"preferredVendorId" in item && item.preferredVendorId ? (
              <Text>Preferred Vendor: {String((item as any).preferredVendorId)}</Text>
            ) : null}
            <Text>Tap to {selected[item.id] ? "unselect" : "select"}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
