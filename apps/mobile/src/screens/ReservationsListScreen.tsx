// apps/mobile/src/screens/ReservationsListScreen.tsx
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listReservations } from "../features/reservations/api";
import { useTheme } from "../providers/ThemeProvider";
import { FEATURE_RESERVATIONS_ENABLED } from "../features/_shared/flags";
import type { Reservation } from "../features/reservations/types";
import type { RootStackParamList } from "../navigation/types";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ReservationsListScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [q, setQ] = React.useState("");
  const [reservations, setReservations] = React.useState<Reservation[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [next, setNext] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadReservations();
  }, [q]);

  const loadReservations = async () => {
    setIsLoading(true);
    try {
      const result = await listReservations({ q: q || undefined, limit: 20 });
      setReservations(result.items || []);
      setNext(result.next || null);
    } catch (error) {
      console.error("Failed to load reservations:", error);
      setReservations([]);
      setNext(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!next) return;
    try {
      const result = await listReservations({ q: q || undefined, limit: 20, next });
      setReservations([...reservations, ...(result.items || [])]);
      setNext(result.next || null);
    } catch (error) {
      console.error("Failed to load more reservations:", error);
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

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {/* Create Button (feature-flagged) */}
      {FEATURE_RESERVATIONS_ENABLED && (
        <Pressable
          onPress={() => navigation.navigate("CreateReservation")}
          style={{
            backgroundColor: t.colors.primary,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>+ Create Reservation</Text>
        </Pressable>
      )}

      {/* Search Input */}
      <TextInput
        placeholder="Search reservations (id)"
        placeholderTextColor={t.colors.textMuted}
        value={q}
        onChangeText={setQ}
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
          backgroundColor: t.colors.card,
          color: t.colors.text,
        }}
      />

      {/* List */}
      {isLoading && reservations.length === 0 ? (
        <ActivityIndicator size="large" color={t.colors.primary} />
      ) : reservations.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: t.colors.textMuted }}>No reservations found</Text>
        </View>
      ) : (
        <FlatList
          data={reservations}
          keyExtractor={(item) => item.id}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate("ReservationDetail", { id: item.id })
              }
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 8,
                marginBottom: 8,
                backgroundColor: t.colors.card,
              }}
            >
              <Text
                style={{
                  fontWeight: "600",
                  color: t.colors.text,
                  marginBottom: 4,
                }}
              >
                {item.id}
              </Text>
              <Text style={{ fontSize: 13, color: t.colors.textMuted }}>
                Resource: {(item as any).resourceId}
              </Text>
              <Text style={{ fontSize: 13, color: t.colors.textMuted }}>
                Status: {(item as any).status}
              </Text>
              <Text style={{ fontSize: 12, color: t.colors.textMuted, marginTop: 4 }}>
                {formatDateTime((item as any).startsAt)} →{" "}
                {formatDateTime((item as any).endsAt)}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
