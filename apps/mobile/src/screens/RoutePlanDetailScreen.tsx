import React from "react";
import { View, Text, Pressable, ScrollView, Alert, RefreshControl } from "react-native";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import type { components } from "../api/generated-types";
import { useColors } from "../features/_shared/useColors";
import { routingApi } from "../features/routing/api";

type RoutePlan = components["schemas"]["RoutePlan"];
type Params = { id: string };

export default function RoutePlanDetailScreen({ navigation }: any) {
  const t = useColors();
  const route = useRoute<any>();
  const id = (route?.params as Params | undefined)?.id;

  const [item, setItem] = React.useState<RoutePlan | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await routingApi.getPlan(id);
      setItem((res as RoutePlan) || null);
    } catch (e: any) {
      Alert.alert("Load failed", e?.message ?? "Could not load route plan");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    React.useCallback(() => {
      load();
      return () => {};
    }, [load])
  );

  const onRefresh = React.useCallback(async () => {
    setPulling(true);
    await load();
    setPulling(false);
  }, [load]);

  const onRecompute = async () => {
    try {
      setLoading(true);
      const created = await routingApi.createPlan({
        objective: item?.objective ?? "shortest",
        tasks: [
          { id: "t1", fromNodeId: "A", toNodeId: "D" },
          { id: "t2", fromNodeId: "B", toNodeId: "C" },
        ],
      });
      navigation.replace("RoutePlanDetail", { id: (created as RoutePlan).id });
    } catch (e: any) {
      Alert.alert("Recompute failed", e?.message ?? "Could not recompute plan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 12 }}
      refreshControl={<RefreshControl tintColor={t.colors.text} refreshing={pulling} onRefresh={onRefresh} />}
    >
      {!item ? (
        <Text style={{ color: t.colors.textMuted }}>{loading ? "Loading…" : "No plan loaded."}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>
            Route Plan {item.id}
          </Text>
          <Text style={{ color: t.colors.textMuted }}>
            {item.status ?? "planned"} · {item.objective}
          </Text>

          <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 12 }}>
            <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 6 }}>Summary</Text>
            <Text style={{ color: t.colors.text }}>
              Distance:{" "}
              {item.summary?.distanceKm != null ? `${item.summary.distanceKm.toFixed(1)} km` : "—"}
            </Text>
            <Text style={{ color: t.colors.text }}>
              Duration: {item.summary?.totalDurationMin != null ? `${item.summary.totalDurationMin} min` : "—"}
            </Text>
            <Text style={{ color: t.colors.text }}>
              Cost: {item.summary?.totalCost != null ? `${item.summary.totalCost}` : "—"}
            </Text>
          </View>

          <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 12 }}>
            <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 6 }}>Tasks</Text>
            {Array.isArray(item.tasks) && item.tasks.length > 0 ? (
              item.tasks.map((task, i) => (
                <Text key={`${task.id}-${i}`} style={{ color: t.colors.text }}>
                  • {task.id}
                </Text>
              ))
            ) : (
              <Text style={{ color: t.colors.textMuted }}>No tasks</Text>
            )}
          </View>

          <Pressable
            onPress={onRecompute}
            style={{ backgroundColor: t.colors.primary, padding: 12, borderRadius: 8, alignItems: "center" }}
          >
            <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>Recompute Plan</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
