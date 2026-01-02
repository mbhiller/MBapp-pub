import * as React from "react";
import { View, Text, Pressable, Modal, FlatList } from "react-native";
import type { PurchaseOrderDraft } from "./poActions";

export default function DraftChooserModal({
  visible,
  drafts,
  onPick,
  onClose,
}: {
  visible: boolean;
  drafts: PurchaseOrderDraft[];
  onPick: (draft: PurchaseOrderDraft) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: "#00000077", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "white", padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: "70%" }}>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>Choose a draft PO</Text>
          <FlatList
            data={drafts}
            keyExtractor={(d, idx) => d.id || `${d.vendorId || "draft"}-${idx}`}
            renderItem={({ item }) => {
              const lines = item.lines ?? [];
              return (
                <Pressable
                  onPress={() => onPick(item)}
                  style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" }}
                >
                  <Text style={{ fontWeight: "600" }}>Draft {item.id}</Text>
                  <Text>
                    Vendor: {item.vendorName ? `${item.vendorName} (${item.vendorId})` : item.vendorId || "(unknown)"}
                  </Text>
                  <Text>Lines: {lines.length}</Text>
                  {lines.map((ln, idx) => (
                    <View
                      key={`${item.id}-ln-${ln.lineId || ln.id || ln.itemId || idx}`}
                      style={{ marginTop: 6, paddingVertical: 6, borderTopWidth: idx === 0 ? 1 : 0, borderColor: "#eee" }}
                    >
                      <Text style={{ fontWeight: "600" }}>{ln.itemId || "(item)"}</Text>
                      <Text>
                        Qty: {ln.qtySuggested ?? ln.qty ?? "—"}
                        {ln.uom ? ` ${ln.uom}` : ""}
                      </Text>
                      {ln.qtyRequested != null && ln.qtyRequested !== (ln.qtySuggested ?? ln.qty) && (
                        <Text style={{ color: "#666", fontSize: 12 }}>
                          Requested {ln.qtyRequested}
                          {ln.uom ? ` ${ln.uom}` : ""}
                        </Text>
                      )}
                      {ln.minOrderQtyApplied != null && (
                        <Text style={{ color: "#555", fontSize: 12 }}>
                          MOQ applied: {ln.minOrderQtyApplied}
                          {ln.adjustedFrom != null ? ` (from ${ln.adjustedFrom})` : ""}
                        </Text>
                      )}
                    </View>
                  ))}
                </Pressable>
              );
            }}
          />
          <Pressable onPress={onClose} style={{ marginTop: 10, padding: 12, alignSelf: "flex-end" }}>
            <Text style={{ fontWeight: "600" }}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
