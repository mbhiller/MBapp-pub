// apps/mobile/src/screens/modulehubscreen.tsx
import React from "react";
import { ScrollView, View, Text, Pressable, RefreshControl } from "react-native";
import MODULES, { visibleModules } from "../features/_shared/modules";
import { useColors } from "../features/_shared/useColors";
import { usePolicy } from "../providers/PolicyProvider";
import { FEATURE_REGISTRATIONS_ENABLED } from "../features/_shared/flags";

export default function ModuleHubScreen({ navigation }: any) {
  const t = useColors();
  const { policy, policyLoading, policyError, refetchPolicy } = usePolicy();

  const modules = React.useMemo(() => visibleModules(policy), [policy]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={policyLoading} onRefresh={refetchPolicy} />}
    >
      {policyError && (
        <View
          style={{
            padding: 10,
            marginBottom: 12,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700" }}>
            Policy unavailable — check auth
          </Text>
        </View>
      )}

      {/* DEV DEBUG: Remove after confirming tile appears */}
      {__DEV__ && (
        <View style={{ padding: 8, backgroundColor: "#e8f4fd", borderRadius: 6, marginBottom: 12 }}>
          <Text style={{ fontSize: 11, fontFamily: "monospace" }}>
            registrationsEnabled={String(FEATURE_REGISTRATIONS_ENABLED)} | visibleModules={modules.length}
          </Text>
        </View>
      )}

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

      {!policyLoading && modules.length === 0 && !policyError && (
        <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
          No modules available for your role.
        </Text>
      )}

      {policyLoading && modules.length === 0 && (
        <Text style={{ color: t.colors.muted, textAlign: "center", marginTop: 24 }}>
          Loading permissions...
        </Text>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
