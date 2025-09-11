import React from "react";
import { ScrollView, View, Text, TouchableOpacity } from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";
import { useRoles } from "../providers/RolesProvider";
import { MODULES } from "../shared/modules";

export default function ModuleHubScreen({ navigation }: RootStackScreenProps<"Hub">) {
  const t = useTheme();
  const { roles, allowedModules, toggleRole } = useRoles();

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, backgroundColor: t.colors.bg }}>
      <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>MODULES</Text>

      <View style={{ gap: 10 }}>
        {allowedModules.map((key) => {
          const m = MODULES[key];
          return (
            <TouchableOpacity
              key={key}
              onPress={() => navigation.navigate(m.route as any, m.params)}
              style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, padding: 14 }}
            >
              <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>{m.title}</Text>
              <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>{key}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ height: 1, backgroundColor: t.colors.border, marginVertical: 16 }} />

      <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>ROLES (local dev toggles)</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {(["internal", "inventory", "catalog", "admin"] as const).map((r) => {
          const active = roles.includes(r);
          return (
            <TouchableOpacity
              key={r}
              onPress={() => toggleRole(r)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 20,
                backgroundColor: active ? "#dfe9ff" : t.colors.card,
                borderWidth: 1,
                borderColor: t.colors.border
              }}
            >
              <Text style={{ color: active ? "#1b4ed8" : t.colors.text, fontWeight: "600" }}>{r}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={{ color: t.colors.textMuted, marginTop: 8 }}>
        These toggles are in-app only for now; we’ll wire real user roles from the backend later.
      </Text>
    </ScrollView>
  );
}
