import * as React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useObjectsList } from "../features/_shared/useObjectsList";
import type { components } from "../api/generated-types";
type Account = components["schemas"]["Account"];

export default function AccountsListScreen({ navigation }: any) {
  const t = useColors();
  const q = useObjectsList<Account>({ type: "account", limit: 20, by: "updatedAt", sort: "desc" });

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => {
    setPulling(true);
    try { await q.refetch(); } finally { setPulling(false); }
  }, [q]);
  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  const renderItem = ({ item }: { item: Account }) => {
    const id = String((item as any)?.id ?? "");
    const title =
      (item as any)?.name ??
      (item as any)?.displayName ??
      `Account ${id ? id.slice(0, 8) : ""}`;

    const parts: string[] = [];
    if ((item as any)?.number)     parts.push(`#${(item as any).number}`);
    if ((item as any)?.accountType)parts.push(String((item as any).accountType));
    if ((item as any)?.currency)   parts.push(String((item as any).currency));
    if ((item as any)?.status)     parts.push(`Status: ${(item as any).status}`);
    const subtitle = parts.join(" • ") || "—";

    return (
      <Pressable
        onPress={() => navigation.navigate("AccountDetail", { id, mode: "edit" })}
        style={{
          backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1,
          borderRadius: 12, marginBottom: 10, padding: 12
        }}
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
            {q.isLoading ? (
              <ActivityIndicator/>
            ) : q.isError ? (
              <Text style={{ color: t.colors.danger }}>
                Error: {String(q.error?.message ?? "unknown")}
              </Text>
            ) : (
              <Text style={{ color: t.colors.muted }}>No accounts.</Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />

      {/* + New */}
      <Pressable
        onPress={() => navigation.navigate("AccountDetail", { mode: "new" })}
        style={{
          position: "absolute", right: 16, bottom: 16,
          backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
