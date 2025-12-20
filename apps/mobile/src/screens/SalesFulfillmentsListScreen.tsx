import * as React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { listObjects } from "../api/client";
import { useFocusEffect, useNavigation } from "@react-navigation/native";

type SalesFulfillment = {
  id: string;
  soId: string;
  soNumber?: string;
  customerName?: string;
  createdAt: string;
  lines?: Array<{ lineId: string; deltaQty: number; itemId?: string }>;
};

export default function SalesFulfillmentsListScreen() {
  const t = useColors();
  const nav = useNavigation<any>();
  const [data, setData] = React.useState<SalesFulfillment[]>([]);
  const [next, setNext] = React.useState<string | undefined>();
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchPage = React.useCallback(async (cursor?: string, replace?: boolean) => {
    setLoading(true);
    try {
      const page = await listObjects<SalesFulfillment>("salesFulfillment", { limit: 20, next: cursor, by: "createdAt", sort: "desc" });
      setData((d) => (replace ? (page.items || []) : [...d, ...(page.items || [])]));
      setNext(page.next);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      fetchPage(undefined, true);
    }, [fetchPage])
  );

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await fetchPage(undefined, true);
    setRefreshing(false);
  }, [fetchPage]);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <FlatList
        data={data}
        keyExtractor={(x) => x.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => nav.navigate("SalesOrderDetail", { id: item.soId, highlightFulfillmentId: item.id })}
            style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border }}
          >
            <Text style={{ fontWeight: "600" }}>{item.soNumber || item.soId}</Text>
            <Text style={{ color: t.colors.textMuted }}>
              {item.customerName || "Customer"} • {new Date(item.createdAt).toLocaleString()}
            </Text>
            <Text numberOfLines={1} style={{ marginTop: 4 }}>{`${item.lines?.length || 0} lines`}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          next ? (
            <Pressable onPress={() => fetchPage(next)} style={{ padding: 12, alignItems: "center" }}>
              {loading ? <ActivityIndicator /> : <Text>Load more</Text>}
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}
