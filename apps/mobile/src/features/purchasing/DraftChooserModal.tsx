import * as React from "react";
import { View, Text, Pressable, Modal, FlatList } from "react-native";

export type PurchaseOrderDraft = {
  id: string;
  vendorId: string;
  lines: { itemId: string; qty: number }[];
};

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
            keyExtractor={(d) => d.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item)}
                style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" }}
              >
                <Text style={{ fontWeight: "600" }}>Draft {item.id}</Text>
                <Text>Vendor: {item.vendorId || "(unknown)"}</Text>
                <Text>Lines: {item.lines.length}</Text>
              </Pressable>
            )}
          />
          <Pressable onPress={onClose} style={{ marginTop: 10, padding: 12, alignSelf: "flex-end" }}>
            <Text style={{ fontWeight: "600" }}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
