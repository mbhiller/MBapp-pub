// apps/mobile/src/screens/RegistrationDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, ScrollView, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { getRegistration } from "../features/registrations/api";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../providers/ThemeProvider";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RoutePropType = RouteProp<RootStackParamList, "RegistrationDetail">;

export default function RegistrationDetailScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();

  const registrationId = route.params?.id;
  const [registration, setRegistration] = React.useState<any | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [lastError, setLastError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void load();
  }, [registrationId]);

  const load = async () => {
    if (!registrationId) {
      setLastError("No registration id provided");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLastError(null);
    try {
      const res = await getRegistration(registrationId);
      setRegistration(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      setRegistration(null);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  const renderField = (label: string, value: any) => {
    const display = value === null || value === undefined || value === "" ? "—" : String(value);
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>{label}</Text>
        <Text style={{ fontSize: 14, color: t.colors.text, fontWeight: "500" }}>{display}</Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  if (lastError || !registration) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: t.colors.bg }}>
        <View
          style={{
            padding: 10,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 4 }}>
            Error loading registration
          </Text>
          <Text style={{ color: "#8a1f2d" }}>{lastError || "Registration not found"}</Text>
        </View>
        <Pressable
          onPress={load}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: t.colors.primary,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={{ padding: 16 }}
    >
      <View
        style={{
          padding: 16,
          backgroundColor: t.colors.card,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.colors.border,
          marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "700", color: t.colors.text, marginBottom: 8 }}>
          {registration.id || "Registration"}
        </Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
          Status: {registration.status || "—"}
        </Text>
      </View>

      <View
        style={{
          padding: 16,
          backgroundColor: t.colors.card,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: "700", color: t.colors.text, marginBottom: 12 }}>
          Details
        </Text>
        {renderField("Event ID", registration.eventId)}
        {renderField("Party ID", registration.partyId)}
        {renderField("Division", (registration as any).division)}
        {renderField("Class", (registration as any).class)}
        {renderField("Created", formatDateTime(registration.createdAt))}
        {renderField("Updated", formatDateTime(registration.updatedAt))}
      </View>
    </ScrollView>
  );
}
