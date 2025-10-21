import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useObjectsList } from "../features/_shared/useObjectsList";

export default function InventoryListScreen() {
  const nav = useNavigation<any>();
  const [q, setQ] = React.useState("");
  const { data, isLoading, refetch } = useObjectsList<any>({ type: "inventory", q });
  React.useEffect(() => { refetch(); }, [q]);
  const items = data?.pages?.flatMap((p: any) => p.items) ?? [];

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <TextInput placeholder="Search inventory" value={q} onChangeText={setQ}
        style={{ borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 8 }} />
      {isLoading ? <ActivityIndicator /> : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => nav.navigate("InventoryDetail", { id: item.id })}>
              <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
                <Text style={{ fontWeight: "600" }}>{item.name || item.id}</Text>
                <Text>Product: {item.productId || "—"}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
