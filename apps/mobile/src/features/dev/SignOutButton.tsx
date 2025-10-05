// apps/mobile/src/features/dev/SignOutButton.tsx
import * as React from "react";
import { Pressable, Text, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { devSignOut } from "../../api/auth";
import { useColors } from "../_shared/useColors";

export default function SignOutButton() {
  const nav = useNavigation<any>();
  const t = useColors();

  return (
    <Pressable
      onPress={async () => {
        try {
          await devSignOut();
          // Hard reset to Hub (or your auth bootstrap entry)
          nav.reset({ index: 0, routes: [{ name: "Hub" }] });
        } catch (e: any) {
          Alert.alert("Sign out failed", e?.message ?? "Unknown error");
        }
      }}
      style={{ paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Sign out</Text>
    </Pressable>
  );
}
