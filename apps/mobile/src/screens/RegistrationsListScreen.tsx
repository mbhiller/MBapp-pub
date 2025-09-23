import React from "react";
import { View, FlatList, Text, Pressable, RefreshControl } from "react-native";
import { Registrations } from "../features/registrations/hooks";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";

export default function RegistrationsListScreen({ navigation, route }: any) {
  const t = useColors();
  const eventId = route?.params?.eventId as string | undefined;

  const ql = Registrations.useList({ limit: 20, eventId });
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
        keyExtractor={(i, idx) => String(i.id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={({ item }) => {
          const status = (item as any)?.status ? String((item as any).status) : undefined;
          const when = item?.startsAt
            ? `Starts: ${new Date(item.startsAt).toLocaleString()}`
            : item?.registeredAt
            ? `Registered: ${new Date(item.registeredAt).toLocaleString()}`
            : undefined;

          return (
            <Pressable
              onPress={() => navigation.navigate("RegistrationDetail", { id: String(item.id), mode: "edit" })}
              style={{
                backgroundColor: t.colors.card,
                borderColor: t.colors.border,
                borderWidth: 1, borderRadius: 12,
                marginBottom: 10, padding: 12,
              }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>
                {(item as any)?.clientId || "(no client)"}
              </Text>
              {!!status && <Text style={{ color: t.colors.muted, marginTop: 2 }}>Status: {status}</Text>}
              {!!when && <Text style={{ color: t.colors.muted, marginTop: 2 }}>{when}</Text>}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>No registrations yet.</Text>
        }
        contentContainerStyle={{ paddingBottom: 72 }}
      />
      <Pressable
        onPress={() => navigation.navigate("RegistrationDetail", { mode: "new", ...(eventId ? { initial: { eventId } } : {}) })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
