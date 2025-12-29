import * as React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

type HeaderBadgeProps = { count?: number | null | undefined; breakdown?: { open: number; ignored: number; converted: number; fulfilled: number; total: number; totalQty: number } };
type LineBadgeProps = { qty?: number | null | undefined; onPress?: () => void };

export function BackorderHeaderBadge({ count, breakdown }: HeaderBadgeProps) {
  const n = typeof count === "number" ? count : 0;
  
  // If breakdown provided, show status breakdown
  if (breakdown && breakdown.total > 0) {
    return (
      <View style={styles.breakdownWrap}>
        <View style={styles.breakdownHeader}>
          <Text style={styles.breakdownTitle}>Active Backorders</Text>
        </View>
        <View style={styles.breakdownRow}>
          {breakdown.open > 0 && (
            <View style={[styles.statusBadge, styles.openBadge]}>
              <Text style={styles.statusText}>Open {breakdown.open}</Text>
            </View>
          )}
          {breakdown.converted > 0 && (
            <View style={[styles.statusBadge, styles.convertedBadge]}>
              <Text style={styles.statusText}>Converted {breakdown.converted}</Text>
            </View>
          )}
          {breakdown.fulfilled > 0 && (
            <View style={[styles.statusBadge, styles.fulfilledBadge]}>
              <Text style={styles.statusText}>Fulfilled {breakdown.fulfilled}</Text>
            </View>
          )}
          {breakdown.ignored > 0 && (
            <View style={[styles.statusBadge, styles.ignoredBadge]}>
              <Text style={styles.statusText}>Ignored {breakdown.ignored}</Text>
            </View>
          )}
        </View>
        <Text style={styles.totalQty}>({breakdown.totalQty} units)</Text>
      </View>
    );
  }
  
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
  breakdownWrap: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  breakdownHeader: {
    marginBottom: 8,
  },
  breakdownTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  breakdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  openBadge: {
    backgroundColor: "#ffebee",
  },
  convertedBadge: {
    backgroundColor: "#e3f2fd",
  },
  fulfilledBadge: {
    backgroundColor: "#e8f5e9",
  },
  ignoredBadge: {
    backgroundColor: "#f5f5f5",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "500",
  },
  totalQty: {
    fontSize: 11,
    color: "#999",
  },
});
