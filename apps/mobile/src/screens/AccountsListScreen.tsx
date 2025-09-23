import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Accounts } from "../features/accounts/hooks";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function AccountsListScreen({ navigation }: any) {
  const t = useColors();
  const ql = Accounts.useList({ limit: 20 });
  const { data, refetch } = ql;

  const [pulling, setPulling] = React.useState(false);
  const refetchStable = React.useCallback(() => {
    if (!ql.isRefetching && !ql.isLoading) refetch();
  }, [refetch, ql.isRefetching, ql.isLoading]);
  useRefetchOnFocus(refetchStable, { debounceMs: 150 });

  const onPull = React.useCallback(async () => {
    setPulling(true);
    try { await refetch(); } finally { setPulling(false); }
  }, [refetch]);

  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <FlatList
        data={items}
        keyExtractor={(i, idx) => String((i as any)?.id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={({ item }) => {
          const id = String((item as any)?.id ?? "");
          const status = (item as any)?.status ? String((item as any).status) : undefined;
          const number = (item as any)?.number ? String((item as any).number) : undefined;
          const currency = (item as any)?.currency ? String((item as any).currency) : undefined;

          return (
            <Pressable
              onPress={() => navigation.navigate("AccountDetail", { id, mode: "edit" })}
              style={{
                backgroundColor: t.colors.card,
                borderColor: t.colors.border,
                borderWidth: 1, borderRadius: 12,
                marginBottom: 10, padding: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexShrink: 1, paddingRight: 12 }}>
                  <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>
                    {(item as any)?.name ?? "—"}
                  </Text>
                  <Text style={{ color: t.colors.muted, marginTop: 2 }}>
                    {status ? `Status: ${status}` : "Status: —"}
                  </Text>
                  {number ? (
                    <Text style={{ color: t.colors.muted, marginTop: 2 }}>Number: {number}</Text>
                  ) : null}
                  {currency ? (
                    <Text style={{ color: t.colors.muted, marginTop: 2 }}>Currency: {currency}</Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>No accounts yet.</Text>}
        contentContainerStyle={{ paddingBottom: 72 }}
      />
      <Pressable
        onPress={() => navigation.navigate("AccountDetail", { mode: "new" })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
