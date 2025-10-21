import React from "react";
import { View, Text, ScrollView, Pressable, ScrollViewProps } from "react-native";
import { useColors } from "./useColors";

export type FormScreenProps = ScrollViewProps & {
  /** Optional title rendered as a simple header row */
  title?: string;
  /** Optional save handler; if provided, a Save button appears in the header */
  onSave?: () => void | Promise<void>;
  /** Optional back handler; if provided, a Back button appears in the header */
  onBack?: () => void | Promise<void>;
  /** Padding applied inside the ScrollView */
  contentPadding?: number;
  /** Optional custom right-side actions; overrides default Save button */
  actionsRight?: React.ReactNode;
  /** Optional custom left-side actions; overrides default Back button */
  actionsLeft?: React.ReactNode;
  children: React.ReactNode;
};

export default function FormScreen({
  title,
  onSave,
  onBack,
  actionsRight,
  actionsLeft,
  contentContainerStyle,
  contentPadding = 12,
  children,
  ...scrollProps
}: FormScreenProps) {
  const t = useColors();

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      {(title || onSave || onBack || actionsLeft || actionsRight) && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {actionsLeft ??
              (onBack && (
                <Pressable
                  onPress={() => onBack?.()}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderWidth: 1,
                    borderColor: t.colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: t.colors.text }}>Back</Text>
                </Pressable>
              ))}
            {title ? (
              <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>
                {title}
              </Text>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {actionsRight ??
              (onSave && (
                <Pressable
                  onPress={() => onSave?.()}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    backgroundColor: t.colors.primary,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
                    Save
                  </Text>
                </Pressable>
              ))}
          </View>
        </View>
      )}

      <ScrollView
        {...scrollProps}
        contentContainerStyle={[
          { padding: contentPadding, gap: 10 },
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}
