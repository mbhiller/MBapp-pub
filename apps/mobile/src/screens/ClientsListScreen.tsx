import * as React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useObjectsList } from "../features/_shared/useObjectsList";
import type { components } from "../api/generated-types";
type Client = components["schemas"]["Client"];

export default function ClientsListScreen({ navigation }: any) {
  const t = useColors();
  const q = useObjectsList<Client>({ type: "client", limit: 20, by: "updatedAt", sort: "desc" });

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => { setPulling(true); try { await q.refetch(); } finally { setPulling(false); } }, [q]);
  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  const renderItem = ({ item }: { item: Client }) => {
    const id = String((item as any)?.id ?? "");
    const nameParts = [ (item as any)?.firstName, (item as any)?.lastName ]
  .filter((s): s is string => !!s);
const fullName = nameParts.join(" ");

const title =
  (item as any).name ??
  (item as any).displayName ??
  (fullName || `Client ${id.slice(0, 8)}`);

    const parts: string[] = [];
    if ((item as any).email) parts.push((item as any).email);
    if ((item as any).phone) parts.push((item as any).phone);
    const subtitle = parts.join(" • ") || "—";

    return (
      <Pressable
        onPress={() => navigation.navigate("ClientDetail", { id, mode: "edit" })}
        style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, marginBottom: 10, padding: 12 }}
      >
        <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
        <Text style={{ color: t.colors.muted, marginTop: 2 }}>{subtitle}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <FlatList
        data={q.items}
        keyExtractor={(i, idx) => String((i as any)?.id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            {q.isLoading ? <ActivityIndicator/> :
             q.isError   ? <Text style={{ color: t.colors.danger }}>Error: {String(q.error?.message ?? "unknown")}</Text> :
                           <Text style={{ color: t.colors.muted }}>No clients.</Text>}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />

      {/* + New */}
      <Pressable
        onPress={() => navigation.navigate("ClientDetail", { mode: "new" })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
