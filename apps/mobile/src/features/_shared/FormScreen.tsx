import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  ScrollViewProps,
} from "react-native";
import { useColors } from "./useColors";

type Props = ScrollViewProps & {
  children: React.ReactNode;
  /** Convenience padding shorthand; merges into contentContainerStyle */
  contentPadding?: number;
};

export default function FormScreen({
  children,
  contentPadding = 16,
  contentContainerStyle,
  keyboardShouldPersistTaps,
  keyboardDismissMode,
  ...rest
}: Props) {
  const t = useColors();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView
        // sensible defaults, allow override via props
        keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? "handled"}
        keyboardDismissMode={keyboardDismissMode ?? (Platform.OS === "ios" ? "interactive" : "on-drag")}
        alwaysBounceVertical={false}
        contentContainerStyle={[
          { padding: contentPadding }, // default padding
          contentContainerStyle,       // caller overrides/extends
        ]}
        {...rest} // allow refreshControl, etc.
      >
        <View style={{ flex: 1 }}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
