import React, { PropsWithChildren } from "react";
import { View, ScrollView, Text, ViewStyle } from "react-native";
import { useTheme } from "../providers/ThemeProvider";

type Props = PropsWithChildren<{
  title?: string;
  scroll?: boolean;
  style?: ViewStyle | ViewStyle[];
}>;

export function Screen({ title, scroll = true, children, style }: Props) {
  const t = useTheme();
  const Container: any = scroll ? ScrollView : View;

  return (
    <Container
      style={[{ flex: 1, backgroundColor: t.colors.bg }, style as any]}
      contentContainerStyle={scroll ? { padding: 16 } : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {title ? (
        <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
          {title}
        </Text>
      ) : null}
      {children}
    </Container>
  );
}
