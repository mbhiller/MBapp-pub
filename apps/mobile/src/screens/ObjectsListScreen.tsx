import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, TextInput } from "react-native";
import { ObjectsAPI } from "../features/objects/api";
import { useColors } from "../providers/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";


export default function ObjectsListScreen({ navigation }: any) {
  const t = useColors();
  
  const [type, setType] = React.useState("client");
  const [data, setData] = React.useState<{ items: any[]; next?: string } | null>(null);
  const [loading, setLoading] = React.useState(false);
  

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const page = await ObjectsAPI.list(type, { limit: 20 });
      setData(page);
    } finally { setLoading(false); }
  }, [type]);

  React.useEffect(() => { load(); }, [load]);
  useRefetchOnFocus(load);
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 8 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>Type</Text>
      <TextInput value={type} onChangeText={setType}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text, backgroundColor: t.colors.card, marginBottom: 8 }} />
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("ObjectDetail", { type, id: item.id })} style={{ padding: 12 }}>
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>{`${item.type}: ${item.id}`}</Text>
            <Text style={{ color: t.colors.muted, marginTop: 2 }}>{item.name || JSON.stringify(item).slice(0, 80)}</Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.colors.border }} />}
      />
      <Pressable
        onPress={() => navigation.navigate("ObjectDetail", { type, id: undefined })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
  
}

