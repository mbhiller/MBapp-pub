import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects"

export default function PurchaseOrdersListScreen() {
  const nav = useNavigation<any>();
  const [q, setQ] = React.useState("");
  const { data, isLoading, reset, hasNext, fetchNext } = useObjects<any>({ type: "purchaseOrder", q });
  // On query change, restart pagination instead of just refetching
   React.useEffect(() => { reset?.(); }, [q]);
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <TextInput
        placeholder="Search purchase orders"
        value={q}
        onChangeText={setQ}
        style={{ borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 8 }}
      />
      {isLoading && items.length === 0 ? <ActivityIndicator /> : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          renderItem={({ item }) => (
            <Pressable onPress={() => nav.navigate("PurchaseOrderDetail", { id: item.id })}>
              <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
                <Text style={{ fontWeight: "600" }}>{item.id}</Text>
                <Text>Status: {item.status}</Text>
              </View>
            </Pressable>
          )}
          // Pull-to-refresh resets pagination
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => reset?.()} />}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (hasNext && !isLoading) fetchNext?.(); }}
          ListFooterComponent={
            isLoading ? (
              <ActivityIndicator style={{ marginVertical: 12 }} />
            ) : hasNext ? (
              <Pressable onPress={() => fetchNext?.()} style={{ paddingVertical: 12, alignItems: "center" }}>
                <Text style={{ textAlign: "center" }}>Load more</Text>
              </Pressable>
            ) : (
              <Text style={{ textAlign: "center", opacity: 0.6, paddingVertical: 12 }}>End of list</Text>
            )
          }
        />
      )}
    </View>
  );
}
