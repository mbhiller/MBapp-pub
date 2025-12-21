// apps/mobile/src/screens/ReservationDetailScreen.tsx
import * as React from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { getReservation } from "../features/reservations/api";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackParamList } from "../navigation/types";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RoutePropType = RouteProp<RootStackParamList, "ReservationDetail">;

export default function ReservationDetailScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const [reservation, setReservation] = React.useState<any | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const reservationId = route.params?.id;

  React.useEffect(() => {
    if (reservationId) {
      loadReservation();
    }
  }, [reservationId]);

  const loadReservation = async () => {
    if (!reservationId) {
      setError("No reservation ID provided");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await getReservation(reservationId);
      setReservation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reservation");
      console.error("Failed to load reservation:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDateTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return isoString;
    }
  };

  const renderField = (label: string, value: any) => {
    const displayValue =
      value === null || value === undefined ? "—" : String(value);
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>
          {label}
        </Text>
        <Text style={{ fontSize: 14, color: t.colors.text, fontWeight: "500" }}>
          {displayValue}
        </Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: t.colors.bg,
        }}
      >
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  if (error || !reservation) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 20,
          backgroundColor: t.colors.bg,
        }}
      >
        <Text style={{ color: "red", textAlign: "center" }}>
          {error || "Reservation not found"}
        </Text>
        <Pressable
          onPress={loadReservation}
          style={{
            marginTop: 16,
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: t.colors.primary,
            borderRadius: 8,
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
      {/* Header Card */}
      <View
        style={{
          padding: 16,
          backgroundColor: t.colors.card,
          borderRadius: 8,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: "700",
            color: t.colors.text,
            marginBottom: 8,
          }}
        >
          {reservation.id}
        </Text>
        <View
          style={{
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: t.colors.border,
          }}
        >
          {renderField(
            "Status",
            reservation.status?.toUpperCase?.() || reservation.status
          )}
        </View>
      </View>

      {/* Details Card */}
      <View
        style={{
          padding: 16,
          backgroundColor: t.colors.card,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "700",
            color: t.colors.text,
            marginBottom: 12,
          }}
        >
          Details
        </Text>

        {renderField("Resource ID", reservation.resourceId)}
        {renderField("Starts At", formatDateTime(reservation.startsAt))}
        {renderField("Ends At", formatDateTime(reservation.endsAt))}

        {/* Additional fields if present */}
        {reservation.createdAt && renderField("Created", formatDateTime(reservation.createdAt))}
        {reservation.updatedAt && renderField("Updated", formatDateTime(reservation.updatedAt))}
      </View>

      {/* Refresh Button */}
      <Pressable
        onPress={loadReservation}
        style={{
          marginTop: 20,
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: t.colors.primary,
          borderRadius: 8,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}
