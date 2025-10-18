import React from "react";
import { View, FlatList, Text, Pressable, TextInput, RefreshControl, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { listObjects } from "../api/client";
import type { components } from "../api/generated-types";
import { useColors } from "../features/_shared/useColors";
import { routingApi } from "../features/routing/api";

type RoutePlan = components["schemas"]["RoutePlan"];
type Props = { navigation: any };

const SAMPLE_TASKS = [
  { id: "t1", fromNodeId: "A", toNodeId: "D" },
  { id: "t2", fromNodeId: "B", toNodeId: "C" },
];

export default function RoutePlanListScreen({ navigation }: Props) {
  const t = useColors();
  const [items, setItems] = React.useState<RoutePlan[]>([]);
  const [search, setSearch] = React.useState("");
  const [next, setNext] = React.useState<string | undefined>(undefined);
  const [pulling, setPulling] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(
    async (reset = false) => {
      setLoading(true);
      // NOTE: we persist plans with type "routing#plan"
      const page = await listObjects<RoutePlan>("routing#plan", {
        limit: 30,
        q: search || undefined,
        next: reset ? undefined : next,
        by: "updatedAt",
        sort: "desc",
      } as any);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setNext(page.next);
      setLoading(false);
    },
    [search, next]
  );

  useFocusEffect(
    React.useCallback(() => {
      load(true);
      return () => {};
    }, [load])
  );

  const onRefresh = React.useCallback(async () => {
    setPulling(true);
    await load(true);
    setPulling(false);
  }, [load]);

  const onCreatePlan = async () => {
    try {
      setLoading(true);
      const created = await routingApi.createPlan({ objective: "shortest", tasks: SAMPLE_TASKS });
      navigation.navigate("RoutePlanDetail", { id: (created as RoutePlan).id });
    } catch (e: any) {
      Alert.alert("Create plan failed", e?.message ?? "Unable to create plan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: 12, borderBottomWidth: 1, borderColor: t.colors.border }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search route plans"
          placeholderTextColor={t.colors.textMuted}
          onSubmitEditing={() => load(true)}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            color: t.colors.text,
          }}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        refreshControl={
          <RefreshControl tintColor={t.colors.text} refreshing={pulling} onRefresh={onRefresh} />
        }
        onEndReached={() => next && !loading && load(false)}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("RoutePlanDetail", { id: item.id })}
            style={{ padding: 12, borderBottomWidth: 1, borderColor: t.colors.border }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "600" }}>
              {item.id} · {item.objective}
            </Text>
            <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>
              {item.status ?? "planned"}
              {item.summary?.distanceKm != null ? ` · ${item.summary.distanceKm.toFixed(1)} km` : ""}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={{ color: t.colors.textMuted, padding: 12 }}>
            No route plans yet. Tap + New to create one.
          </Text>
        }
      />

      <Pressable
        onPress={onCreatePlan}
        style={{
          position: "absolute",
          right: 20,
          bottom: 30,
          backgroundColor: t.colors.primary,
          paddingHorizontal: 20,
          paddingVertical: 14,
          borderRadius: 24,
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
