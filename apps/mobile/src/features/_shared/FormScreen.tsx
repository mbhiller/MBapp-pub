import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useColors } from "./useColors";

type Props = { children: React.ReactNode; contentPadding?: number };

export default function FormScreen({ children, contentPadding = 16 }: Props) {
  const t = useColors();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView
        contentContainerStyle={{ padding: contentPadding }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        alwaysBounceVertical={false}
      >
        <View style={{ flex: 1 }}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
