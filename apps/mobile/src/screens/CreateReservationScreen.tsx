// apps/mobile/src/screens/CreateReservationScreen.tsx
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createReservation, getResourceAvailability } from "../features/reservations/api";
import ResourcePicker from "../features/resources/ResourcePicker";
import { useToast } from "../features/_shared/Toast";
import { useTheme } from "../providers/ThemeProvider";
import type { Reservation } from "../features/reservations/types";
import type { RootStackParamList } from "../navigation/types";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Helper: compute next available slot based on busyBlocks
function computeNextAvailableSlot(
  desiredStart: Date,
  durationMs: number,
  busyBlocks: Reservation[]
): { start: Date; end: Date } | null {
  // Sort busy blocks by startsAt
  const sorted = busyBlocks
    .filter((b) => b.startsAt && b.endsAt)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  let candidateStart = desiredStart;
  const MAX_ITERATIONS = 20;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    const candidateEnd = new Date(candidateStart.getTime() + durationMs);
    let foundOverlap = false;

    for (const block of sorted) {
      const blockStart = new Date(block.startsAt);
      const blockEnd = new Date(block.endsAt);

      // Check overlap: (candidateStart < blockEnd) && (blockStart < candidateEnd)
      if (candidateStart < blockEnd && blockStart < candidateEnd) {
        // Move candidate start to end of this block
        candidateStart = blockEnd;
        foundOverlap = true;
        break; // restart scan with new candidateStart
      }
    }

    if (!foundOverlap) {
      // No overlap found, return the slot
      return { start: candidateStart, end: new Date(candidateStart.getTime() + durationMs) };
    }
  }

  return null; // Could not find a slot within max iterations
}

export default function CreateReservationScreen() {
  const t = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const toast = useToast();

  const [resourceId, setResourceId] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [status, setStatus] = React.useState("pending");
  const [isPickerVisible, setIsPickerVisible] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [errorCode, setErrorCode] = React.useState("");
  const [conflicts, setConflicts] = React.useState<any[]>([]);
  const [busyBlocks, setBusyBlocks] = React.useState<Reservation[]>([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = React.useState(false);

  // Fetch availability when resourceId is selected (14-day window from now)
  React.useEffect(() => {
    if (!resourceId) {
      setBusyBlocks([]);
      return;
    }

    const fetchAvailability = async () => {
      setIsLoadingAvailability(true);
      try {
        const now = new Date();
        const from = now.toISOString();
        const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

        const result = await getResourceAvailability(resourceId, from, to);
        setBusyBlocks(result.busy || []);
      } catch (err) {
        console.error("Failed to fetch availability:", err);
        setBusyBlocks([]);
      } finally {
        setIsLoadingAvailability(false);
      }
    };

    fetchAvailability();
  }, [resourceId]);

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
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setErrorCode("");
    setConflicts([]);
    setIsSaving(true);

    try {
      const reservation = await createReservation({
        resourceId,
        startsAt,
        endsAt,
        status,
      });
      toast("Reservation created", "success");
      navigation.goBack();
    } catch (err: any) {
      if (err?.code === "conflict") {
        setError(err.message || "Reservation conflicts with existing bookings");
        setErrorCode("conflict");
        setConflicts(err.conflicts || []);
      } else {
        setError(err?.message || "Failed to create reservation");
        setErrorCode("");
        toast(err?.message || "Failed to create reservation", "error");
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

  const formatBusyBlock = (busy: Reservation) => {
    const id = busy.id?.substring(0, 8) || "unknown";
    const start = busy.startsAt || "?";
    const end = busy.endsAt || "?";
    const status = busy.status || "unknown";
    return `${start} – ${end} [${status}] ${id}`;
  };

  const handleUseNextAvailableSlot = () => {
    // Parse current times
    let start: Date | null = null;
    let end: Date | null = null;

    try {
      start = new Date(startsAt);
      end = new Date(endsAt);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        setError("Cannot suggest slot: invalid date format");
        return;
      }
    } catch {
      setError("Cannot suggest slot: invalid date format");
      return;
    }

    const durationMs = end.getTime() - start.getTime();
    if (durationMs <= 0) {
      setError("Cannot suggest slot: duration must be positive");
      return;
    }

    // Compute next available
    const suggestion = computeNextAvailableSlot(start, durationMs, busyBlocks);
    if (!suggestion) {
      setError("No available slot found in the next 14 days with this duration");
      return;
    }

    // Update form with suggested times
    setStartsAt(suggestion.start.toISOString().substring(0, 19));
    setEndsAt(suggestion.end.toISOString().substring(0, 19));

    // Clear error UI
    setError("");
    setConflicts([]);
    toast("Updated to next available slot", "success");
  };

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

      {/* Availability Display */}
      {resourceId && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: t.colors.text, marginBottom: 8 }}>
            Busy Blocks (Next 14 days)
          </Text>
          {isLoadingAvailability ? (
            <ActivityIndicator size="small" color={t.colors.primary} />
          ) : busyBlocks.length === 0 ? (
            <Text style={{ fontSize: 13, color: t.colors.textMuted, padding: 8 }}>
              No busy blocks in this period
            </Text>
          ) : (
            <View
              style={{
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 8,
                backgroundColor: t.colors.card,
                overflow: "hidden",
              }}
            >
              {busyBlocks.map((busy, idx) => (
                <View
                  key={idx}
                  style={{
                    padding: 8,
                    borderBottomWidth: idx < busyBlocks.length - 1 ? 1 : 0,
                    borderBottomColor: t.colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12, color: t.colors.text }}>
                    {formatBusyBlock(busy)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

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

          {/* "Use next available slot" button - show only on conflict with valid times and busy blocks */}
          {(() => {
            try {
              const start = new Date(startsAt);
              const end = new Date(endsAt);
              if (
                errorCode === "conflict" &&
                !isNaN(start.getTime()) &&
                !isNaN(end.getTime()) &&
                busyBlocks.length > 0
              ) {
                return (
                  <Pressable
                    onPress={handleUseNextAvailableSlot}
                    style={{
                      marginTop: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      backgroundColor: t.colors.primary,
                      borderRadius: 6,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>
                      Use next available slot
                    </Text>
                  </Pressable>
                );
              }
              return null;
            } catch {
              return null;
            }
          })()}
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
            Create Reservation
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
