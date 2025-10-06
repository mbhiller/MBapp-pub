import React from "react";
import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "./useColors";

export default function ScanIconButton({ onPress, size = 22 }: { onPress: () => void; size?: number }) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Open scanner"
      style={{
        width: 40, height: 40, borderRadius: 20,
        alignItems: "center", justifyContent: "center",
        borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card,
        marginLeft: 8
      }}
    >
      <Feather name="camera" size={size} color={t.colors.text} />
    </Pressable>
  );
}
