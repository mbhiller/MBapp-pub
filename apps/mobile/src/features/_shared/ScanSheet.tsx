import React from "react";
import { Modal, View, Text, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "./useColors";
import ScanScreen from "../../screens/ScanScreen";

export default function ScanSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useColors();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <View style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>Scan</Text>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={t.colors.text} />
          </Pressable>
        </View>
        <ScanScreen />
      </View>
    </Modal>
  );
}
