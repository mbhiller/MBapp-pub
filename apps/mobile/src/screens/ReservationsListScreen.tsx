// apps/mobile/src/screens/ReservationsListScreen.tsx
import * as React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useObjectsList } from "../features/_shared/useObjectsList";
import type { components } from "../api/generated-types";
import type { RootStackParamList } from "../navigation/types";
type Reservation = components["schemas"]["Reservation"];
type Route = RouteProp<RootStackParamList, "ReservationsList">;

export default function ReservationsListScreen({ navigation }: any) {
  const route = useRoute<Route>();
  // 👇 avoid TS error if your route params don’t declare resourceId
  const resourceId: string | undefined = (route.params as any)?.resourceId;

  const t = useColors();

  const q = useObjectsList<Reservation>({
    type: "reservation",
    limit: 20,
    by: "updatedAt",
    sort: "desc",
    filters: resourceId ? { resourceId } : undefined,
  });

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => { setPulling(true); try { await q.refetch(); } finally { setPulling(false); } }, [q]);
  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: resourceId ? "Reservations (resource)" : "Reservations" });
  }, [navigation, resourceId]);

  const renderItem = ({ item }: { item: Reservation }) => {
    const id = String(item.id ?? "");
    const title = (item as any).name ?? `Reservation ${id.slice(0,8)}`;
    const parts: string[] = [];
    if ((item as any).resourceId) parts.push(`Resource: ${(item as any).resourceId}`);
    if ((item as any).status) parts.push(`Status: ${(item as any).status}`);
    const subtitle = parts.join(" • ") || "—";

    return (
      <Pressable
        onPress={() => navigation.navigate("ReservationDetail", { id, mode: "edit" })}
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
        keyExtractor={(i, idx) => String((i as any).id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            {q.isLoading ? <ActivityIndicator/> :
             q.isError   ? <Text style={{ color: t.colors.danger }}>Error: {String(q.error?.message ?? "unknown")}</Text> :
                           <Text style={{ color: t.colors.muted }}>No reservations.</Text>}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />
      {/* + New (if we came from a resource, seed initial.resourceId) */}
      <Pressable
        onPress={() => navigation.navigate("ReservationDetail", { mode: "new", ...(resourceId ? { initial: { resourceId } } : {}) })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
