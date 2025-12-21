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
import { _debugConfig } from "../api/client";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ReservationsListScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [q, setQ] = React.useState("");
  const [resourceIdFilter, setResourceIdFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("All");
  const [fromFilter, setFromFilter] = React.useState("");
  const [toFilter, setToFilter] = React.useState("");
  const [reservations, setReservations] = React.useState<Reservation[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [next, setNext] = React.useState<string | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [lastStatus, setLastStatus] = React.useState<number | null>(null);

  React.useEffect(() => {
    setReservations([]);
    setNext(null);
    setLastError(null);
    setLastStatus(null);
    loadReservations();
  }, [q]);

  React.useEffect(() => {
    // Reset pagination when client-side filters change to keep load-more consistent
    setReservations([]);
    setNext(null);
    setLastError(null);
    setLastStatus(null);
    loadReservations();
  }, [resourceIdFilter, statusFilter, fromFilter, toFilter]);

  const loadReservations = async () => {
    setIsLoading(true);
    try {
      const result = await listReservations({ q: q || undefined, limit: 20 });
      setReservations(result.items || []);
      setNext(result.next || null);
      setLastError(null);
      setLastStatus(null);
    } catch (error) {
      console.error("Failed to load reservations:", error);
      setReservations([]);
      setNext(null);
      const msg = error instanceof Error ? error.message : "Unknown error";
      const status = (error as any)?.status || (error as any)?.statusCode || null;
      setLastError(msg);
      setLastStatus(status);
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
      setLastError(null);
      setLastStatus(null);
    } catch (error) {
      console.error("Failed to load more reservations:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      const status = (error as any)?.status || (error as any)?.statusCode || null;
      setLastError(msg);
      setLastStatus(status);
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

  // Apply all filters: search (q), resourceId, and status
  const filteredReservations = reservations.filter((item) => {
    const hasFrom = fromFilter.trim().length > 0;
    const hasTo = toFilter.trim().length > 0;
    const fromDate = hasFrom ? new Date(fromFilter) : null;
    const toDate = hasTo ? new Date(toFilter) : null;
    const useFrom = hasFrom && fromDate && !isNaN(fromDate.getTime());
    const useTo = hasTo && toDate && !isNaN(toDate.getTime());

    const startsAt = new Date((item as any).startsAt);
    const endsAt = new Date((item as any).endsAt);
    const startsValid = !isNaN(startsAt.getTime());
    const endsValid = !isNaN(endsAt.getTime());

    // If any date filter is active and parsing fails, exclude this item
    if ((useFrom || useTo) && (!startsValid || !endsValid)) {
      return false;
    }

    if (useFrom && endsAt <= (fromDate as Date)) return false; // needs overlap: reservation.endsAt > from
    if (useTo && startsAt >= (toDate as Date)) return false;   // needs overlap: reservation.startsAt < to

    // resourceId filter (case-insensitive include)
    if (resourceIdFilter.trim()) {
      const itemResourceId = (item as any).resourceId || "";
      if (!itemResourceId.toLowerCase().includes(resourceIdFilter.toLowerCase())) {
        return false;
      }
    }

    // status filter (exact match, unless All)
    if (statusFilter !== "All") {
      const itemStatus = (item as any).status || "";
      if (itemStatus !== statusFilter) {
        return false;
      }
    }

    return true;
  });

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      {/* Error Banner */}
      {lastError && (
        <View
          style={{
            padding: 8,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 2 }}>
            Error loading reservations:
          </Text>
          <Text style={{ color: "#8a1f2d", fontSize: 12 }}>
            {lastError}{lastStatus ? ` (status ${lastStatus})` : ""}
          </Text>
        </View>
      )}

      {/* Debug Line */}
      {(() => {
        const dbg = _debugConfig?.();
        if (!dbg) return null;
        return (
          <Text style={{ color: t.colors.textMuted, fontSize: 11, marginBottom: 6 }}>
            api: {dbg.API_BASE} · tenant: {dbg.TENANT ?? "?"} · feature: reservations={String(FEATURE_RESERVATIONS_ENABLED)}
          </Text>
        );
      })()}

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

      {/* ResourceId Filter */}
      <TextInput
        placeholder="Filter by resourceId"
        placeholderTextColor={t.colors.textMuted}
        value={resourceIdFilter}
        onChangeText={setResourceIdFilter}
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

      {/* Date Filters */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <TextInput
            placeholder="From (ISO)"
            placeholderTextColor={t.colors.textMuted}
            value={fromFilter}
            onChangeText={setFromFilter}
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              padding: 10,
              backgroundColor: t.colors.card,
              color: t.colors.text,
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextInput
            placeholder="To (ISO)"
            placeholderTextColor={t.colors.textMuted}
            value={toFilter}
            onChangeText={setToFilter}
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              padding: 10,
              backgroundColor: t.colors.card,
              color: t.colors.text,
            }}
          />
        </View>
      </View>

      {/* Status Filter */}
      <View style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {["All", "pending", "confirmed", "cancelled"].map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatusFilter(s)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: statusFilter === s ? t.colors.primary : t.colors.border,
                backgroundColor: statusFilter === s ? t.colors.primary : t.colors.card,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: statusFilter === s ? "#fff" : t.colors.text,
                  fontWeight: statusFilter === s ? "700" : "400",
                }}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* List */}
      {isLoading && reservations.length === 0 ? (
        <ActivityIndicator size="large" color={t.colors.primary} />
      ) : filteredReservations.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: t.colors.textMuted }}>No reservations found</Text>
        </View>
      ) : (
        <FlatList
          data={filteredReservations}
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
