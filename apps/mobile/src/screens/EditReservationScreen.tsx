// apps/mobile/src/screens/EditReservationScreen.tsx
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { getReservation, updateReservation } from "../features/reservations/api";
import ResourcePicker from "../features/resources/ResourcePicker";
import { useToast } from "../features/_shared/Toast";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackParamList } from "../navigation/types";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RoutePropType = RouteProp<RootStackParamList, "EditReservation">;

export default function EditReservationScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const toast = useToast();

  const reservationId = route.params?.id;

  const [isLoading, setIsLoading] = React.useState(true);
  const [resourceId, setResourceId] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [status, setStatus] = React.useState("pending");
  const [isPickerVisible, setIsPickerVisible] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [conflicts, setConflicts] = React.useState<any[]>([]);

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
    try {
      const data = await getReservation(reservationId);
      setResourceId(data.resourceId || "");
      setStartsAt(data.startsAt || "");
      setEndsAt(data.endsAt || "");
      setStatus(data.status || "pending");
    } catch (err: any) {
      setError(err?.message || "Failed to load reservation");
      toast(err?.message || "Failed to load reservation", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const validateForm = (): string | null => {
    if (!resourceId) return "Resource is required";
    if (!startsAt) return "Start time is required";
    if (!endsAt) return "End time is required";

    // Validate ISO format and startsAt < endsAt
    try {
      const start = new Date(startsAt);
      const end = new Date(endsAt);
      if (isNaN(start.getTime())) return "Invalid start time format (use ISO: YYYY-MM-DDTHH:mm:ss)";
      if (isNaN(end.getTime())) return "Invalid end time format (use ISO: YYYY-MM-DDTHH:mm:ss)";
      if (start >= end) return "Start time must be before end time";
    } catch {
      return "Invalid date format";
    }

    return null;
  };

  const handleSave = async () => {
    if (!reservationId) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setConflicts([]);
    setIsSaving(true);

    try {
      await updateReservation(reservationId, {
        resourceId,
        startsAt,
        endsAt,
        status,
      });
      toast("Reservation updated", "success");
      navigation.goBack();
    } catch (err: any) {
      if (err?.code === "conflict") {
        setError(err.message || "Reservation conflicts with existing bookings");
        setConflicts(err.conflicts || []);
      } else {
        setError(err?.message || "Failed to update reservation");
        toast(err?.message || "Failed to update reservation", "error");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const formatConflict = (c: any) => {
    if (typeof c === "string") return c;
    if (c?.id) {
      const times = c.startsAt && c.endsAt ? ` (${c.startsAt} → ${c.endsAt})` : "";
      return `${c.id}${times}`;
    }
    return JSON.stringify(c);
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={{ padding: 16 }}
    >
      {/* Resource Picker Field */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: t.colors.text, marginBottom: 8 }}>
          Resource *
        </Text>
        <Pressable
          onPress={() => setIsPickerVisible(true)}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
          }}
        >
          <Text style={{ color: resourceId ? t.colors.text : t.colors.textMuted }}>
            {resourceId || "Select a resource"}
          </Text>
        </Pressable>
      </View>

      {/* Starts At */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: t.colors.text, marginBottom: 8 }}>
          Starts At * (ISO format: YYYY-MM-DDTHH:mm:ss)
        </Text>
        <TextInput
          value={startsAt}
          onChangeText={setStartsAt}
          placeholder="2025-12-21T10:00:00"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
            color: t.colors.text,
          }}
        />
      </View>

      {/* Ends At */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: t.colors.text, marginBottom: 8 }}>
          Ends At * (ISO format: YYYY-MM-DDTHH:mm:ss)
        </Text>
        <TextInput
          value={endsAt}
          onChangeText={setEndsAt}
          placeholder="2025-12-21T12:00:00"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 12,
            backgroundColor: t.colors.card,
            color: t.colors.text,
          }}
        />
      </View>

      {/* Status */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: t.colors.text, marginBottom: 8 }}>
          Status
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {["pending", "confirmed", "cancelled"].map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatus(s)}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: status === s ? t.colors.primary : t.colors.border,
                backgroundColor: status === s ? t.colors.primary : t.colors.card,
              }}
            >
              <Text
                style={{
                  color: status === s ? "#fff" : t.colors.text,
                  fontWeight: status === s ? "700" : "400",
                }}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Validation/Conflict Error */}
      {error ? (
        <View
          style={{
            padding: 12,
            backgroundColor: "#fee",
            borderRadius: 8,
            borderWidth: 1,
            borderColor: "#fcc",
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#c33", fontWeight: "600", marginBottom: 4 }}>
            {error}
          </Text>
          {conflicts.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: "#c33", fontWeight: "600", marginBottom: 4 }}>
                Conflicting Reservations:
              </Text>
              {conflicts.map((c, i) => {
                const conflictId = typeof c === "string" ? c : c?.id;
                return (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ color: "#c33", fontSize: 13, flex: 1 }}>
                      • {formatConflict(c)}
                    </Text>
                    {conflictId && (
                      <Pressable
                        onPress={() => navigation.navigate("ReservationDetail", { id: conflictId })}
                        style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                      >
                        <Text style={{ color: t.colors.primary, fontSize: 12, fontWeight: "600" }}>View</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {/* Save Button */}
      <Pressable
        onPress={handleSave}
        disabled={isSaving}
        style={{
          paddingVertical: 14,
          paddingHorizontal: 16,
          backgroundColor: isSaving ? t.colors.border : t.colors.primary,
          borderRadius: 8,
          alignItems: "center",
          marginTop: 8,
        }}
      >
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
            Save Changes
          </Text>
        )}
      </Pressable>

      {/* Resource Picker Modal */}
      <ResourcePicker
        visible={isPickerVisible}
        onSelect={(id) => {
          setResourceId(id);
          setIsPickerVisible(false);
        }}
        onCancel={() => setIsPickerVisible(false)}
      />
    </ScrollView>
  );
}
