import * as React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

type HeaderBadgeProps = { count?: number | null | undefined };
type LineBadgeProps = { qty?: number | null | undefined; onPress?: () => void };

export function BackorderHeaderBadge({ count }: HeaderBadgeProps) {
  const n = typeof count === "number" ? count : 0;
  if (n <= 0) return null;
  return (
    <View style={styles.headerWrap}>
      <Text style={styles.badge}>Backorders present</Text>
    </View>
  );
}

export function BackorderLineBadge({ qty, onPress }: LineBadgeProps) {
  const n = typeof qty === "number" ? qty : 0;
  if (n <= 0) return null;
  const badge = <Text style={styles.badge}>Backordered ({n})</Text>;
  if (onPress) {
    return (
      <Pressable style={styles.lineWrap} onPress={onPress}>
        {badge}
      </Pressable>
    );
  }
  return (
    <View style={styles.lineWrap}>
      {badge}
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { marginTop: 6, alignSelf: "flex-start" },
  lineWrap: { marginTop: 4, alignSelf: "flex-start" },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    fontSize: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,165,0,0.18)",
    color: "orange",
  },
});
