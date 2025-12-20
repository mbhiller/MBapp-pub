import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";

export default function SalesOrdersListScreen() {
  const nav = useNavigation<any>();
  const [q, setQ] = React.useState("");
  const { data, isLoading, refetch } = useObjects<any>({ type: "salesOrder", q });

  const items = data?.items ?? [];
  React.useEffect(() => { refetch(); }, [q]);

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <TextInput
        placeholder="Search sales orders"
        value={q}
        onChangeText={setQ}
        style={{ borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 8 }}
      />
      {isLoading ? <ActivityIndicator /> : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => nav.navigate("SalesOrderDetail", { id: item.id })}>
              <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
                <Text style={{ fontWeight: "600" }}>{item.id}</Text>
                <Text>Status: {item.status}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
