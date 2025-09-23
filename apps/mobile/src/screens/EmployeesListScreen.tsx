import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Employees } from "../features/employees/hooks";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function EmployeesListScreen({ navigation }: any) {
  const t = useColors();
  const ql = Employees.useList({ limit: 20 });
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
          const role = (item as any)?.role ? String((item as any).role) : undefined;
          const email = (item as any)?.email ? String((item as any).email) : undefined;

          return (
            <Pressable
              onPress={() => navigation.navigate("EmployeeDetail", { id, mode: "edit" })}
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
                    {(item as any)?.displayName ?? "—"}
                  </Text>
                  <Text style={{ color: t.colors.muted, marginTop: 2 }}>
                    {status ? `Status: ${status}` : "Status: —"}
                  </Text>
                  {role ? <Text style={{ color: t.colors.muted, marginTop: 2 }}>Role: {role}</Text> : null}
                  {email ? <Text style={{ color: t.colors.muted, marginTop: 2 }}>Email: {email}</Text> : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>No employees yet.</Text>}
        contentContainerStyle={{ paddingBottom: 72 }}
      />
      <Pressable
        onPress={() => navigation.navigate("EmployeeDetail", { mode: "new" })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
