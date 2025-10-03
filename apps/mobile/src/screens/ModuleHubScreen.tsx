// apps/mobile/src/screens/modulehubscreen.tsx
import React from "react";
import { ScrollView, View, Text, Pressable, RefreshControl } from "react-native";
import MODULES, { visibleModules } from "../features/_shared/modules";
import { useColors } from "../features/_shared/useColors";
import { apiClient } from "../api/client";

export default function ModuleHubScreen({ navigation }: any) {
  const t = useColors();
  const [policy, setPolicy] = React.useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadPolicy = React.useCallback(async () => {
    setLoading(true);
    try {
      const p = await apiClient.get<Record<string, boolean>>("/auth/policy");
      setPolicy(p);
    } catch {
      // If policy fetch fails, we just leave policy=null and show all modules.
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  const modules = React.useMemo(() => visibleModules(policy), [policy]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadPolicy} />}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {modules.map((m) => (
          <Pressable
            key={m.key}
            onPress={() => navigation.navigate(m.screen as any)}
            style={{
              width: "48%",
              minHeight: 90,
              backgroundColor: t.colors.card,
              borderColor: t.colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 4 }}>{m.title}</Text>
            <Text style={{ color: t.colors.muted, fontSize: 12 }}>{m.key}</Text>
          </Pressable>
        ))}
      </View>

      {!loading && modules.length === 0 && (
        <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
          No modules available for your role.
        </Text>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
