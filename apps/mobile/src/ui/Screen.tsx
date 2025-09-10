// apps/mobile/src/ui/Screen.tsx
import React from "react";
import { View, Text, ScrollView, ViewStyle } from "react-native";
import { useTheme } from "./ThemeProvider";

export function Screen({
  title,
  children,
  footer,
  scroll = true,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const Container = scroll ? ScrollView : View;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {title ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: t.text }}>{title}</Text>
        </View>
      ) : null}

      <Container contentContainerStyle={scroll ? { paddingBottom: 24 } : undefined} style={[{ flex: 1 }, style]}>
        {children}
      </Container>

      {footer ? <View style={{ padding: 12 }}>{footer}</View> : null}
    </View>
  );
}
