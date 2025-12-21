
import React from "react";
import { View, Text, Pressable, Keyboard } from "react-native";
import { useColors } from "../_shared/useColors";
import PartyPicker from "./PartyPicker";
import { Party } from "./api";

type Props = {
  role?: string;                    // "customer" | "vendor" | etc.
  onClose: () => void;
  onSelect: (party: Party) => void;
};

export default function PartySelectorModal({ role = "customer", onClose, onSelect }: Props) {
  const t = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
        Select {role}
      </Text>
      <PartyPicker
        role={role}
        onSelect={(p) => {
          Keyboard.dismiss();
          onSelect(p);
          onClose();
        }}
        autoFocus
        placeholder={`Search ${role}s...`}
      />
      <Pressable onPress={onClose} style={{ marginTop: 12, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}>
        <Text style={{ color: t.colors.text }}>Close</Text>
      </Pressable>
    </View>
  );
}
