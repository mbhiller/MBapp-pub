// apps/mobile/src/screens/EventDetailScreen.tsx
import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Events } from "../features/events/hooks";
import { useRegistrationsCount } from "../features/registrations/useRegistrationsCount";
import { useColors } from "../providers/useColors";

function iso(d?: string) { return d ? new Date(d).toLocaleString() : "—"; }
function toIsoOrUndefined(d?: Date | null) { return d ? d.toISOString() : undefined; }
function fromIsoOrNow(s?: string) { return s ? new Date(s) : new Date(); }
function fmtDate(d?: string) {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString(); } catch { return ""; }
}
function fmtTime(d?: string) {
  if (!d) return "";
  try { return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

type PickerTarget = null | { field: "start" | "end"; mode: "date" | "time" };

export default function EventDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const isCreate = !id;

  const t = useColors();
  const get = Events.useGet(id);
  const create = Events.useCreate();
  const update = id ? Events.useUpdate(id) : undefined;

  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [startDate, setStartDate] = React.useState<string | undefined>(undefined);
  const [endDate, setEndDate] = React.useState<string | undefined>(undefined);

  // registrations badge
  const regCountQ = useRegistrationsCount(id);
  const regCount = typeof regCountQ.data === "number" ? regCountQ.data : undefined;

  // minimized pickers (only show when an icon is tapped)
  const [picker, setPicker] = React.useState<PickerTarget>(null);

  // hydrate for edit
  React.useEffect(() => {
    if (isCreate) {
      setName(""); setLocation("");
      setStartDate(undefined); setEndDate(undefined);
      return;
    }
    if (get.data) {
      setName(get.data.name ?? "");
      setLocation(get.data.location ?? "");
      setStartDate(get.data.startDate);
      setEndDate(get.data.endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get.data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    const payload = {
      name: (name || "").trim() || undefined,
      location: (location || "").trim() || undefined,
      startDate,
      endDate,
    };
    if (!payload.name) {
      Alert.alert("Validation", "Event name is required.");
      return;
    }
    try {
      if (id && update) {
        await update.mutateAsync(payload);
        Alert.alert("Saved", "Event updated.");
        navigation.goBack();
      } else {
        const created = await create.mutateAsync(payload);
        Alert.alert("Saved", "Event created.");
        navigation.navigate("EventDetail", { id: created.id });
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  // merge in only the date part from a picker selection
  const applyDatePart = (origIso: string | undefined, picked: Date) => {
    const base = origIso ? new Date(origIso) : new Date();
    const out = new Date(base);
    out.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    return out;
  };
  // merge in only the time part
  const applyTimePart = (origIso: string | undefined, picked: Date) => {
    const base = origIso ? new Date(origIso) : new Date();
    const out = new Date(base);
    out.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    return out;
  };

  const onChangePicker = (e: DateTimePickerEvent, selected?: Date) => {
    if (e.type === "dismissed") { setPicker(null); return; }
    if (!picker || !selected) { setPicker(null); return; }

    if (picker.field === "start") {
      if (picker.mode === "date") {
        const d = applyDatePart(startDate, selected);
        setStartDate(toIsoOrUndefined(d));
      } else {
        const d = applyTimePart(startDate, selected);
        setStartDate(toIsoOrUndefined(d));
      }
    } else {
      if (picker.mode === "date") {
        const d = applyDatePart(endDate, selected);
        setEndDate(toIsoOrUndefined(d));
      } else {
        const d = applyTimePart(endDate, selected);
        setEndDate(toIsoOrUndefined(d));
      }
    }
    setPicker(null);
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.colors.text,
    backgroundColor: t.colors.background,
  } as const;

  const RowField = ({
    label,
    value,
    onPressCalendar,
    onPressClock,
    placeholder,
  }: {
    label: string;
    value: string;
    onPressCalendar: () => void;
    onPressClock: () => void;
    placeholder?: string;
  }) => (
    <Labeled label={label}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: t.colors.background,
        }}
      >
        <TextInput
          style={{ flex: 1, color: t.colors.text, paddingVertical: 6 }}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={t.colors.muted}
          editable={false}
        />
        <Pressable onPress={onPressCalendar} hitSlop={6} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text style={{ color: t.colors.primary, fontSize: 16 }}>📅</Text>
        </Pressable>
        <Pressable onPress={onPressClock} hitSlop={6} style={{ paddingLeft: 4, paddingVertical: 6 }}>
          <Text style={{ color: t.colors.primary, fontSize: 16 }}>⏰</Text>
        </Pressable>
      </View>
    </Labeled>
  );

  if (id && get.isLoading) {
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.colors.background }}>
        <Text style={{ color: t.colors.muted }}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
      {/* Header + Registrations */}
      <Card>
        <SectionTitle title={isCreate ? "New Event" : "Edit Event"} />

        {!isCreate && (
          <Pressable
            onPress={() => navigation.navigate("RegistrationsList", { eventId: id })}
            style={{
              alignSelf: "flex-start",
              backgroundColor: t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 12,
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "700" }}>View Registrations</Text>
            <View
              style={{
                backgroundColor: t.colors.primary,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                marginLeft: 8,
                minWidth: 24,
                alignItems: "center",
              }}
            >
              <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
                {typeof regCount === "number" ? regCount : "—"}
              </Text>
            </View>
          </Pressable>
        )}

        {/* Name */}
        <Labeled label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Event name"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
          />
        </Labeled>

        {/* Location */}
        <Labeled label="Location">
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="Location"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
          />
        </Labeled>

        {/* Start (minimized pickers) */}
        <RowField
          label="Start"
          value={`${fmtDate(startDate)} ${startDate ? "• " + fmtTime(startDate) : ""}`.trim()}
          placeholder="Pick date/time"
          onPressCalendar={() => setPicker({ field: "start", mode: "date" })}
          onPressClock={() => setPicker({ field: "start", mode: "time" })}
        />

        {/* End (minimized pickers) */}
        <RowField
          label="End"
          value={`${fmtDate(endDate)} ${endDate ? "• " + fmtTime(endDate) : ""}`.trim()}
          placeholder="Pick date/time"
          onPressCalendar={() => setPicker({ field: "end", mode: "date" })}
          onPressClock={() => setPicker({ field: "end", mode: "time" })}
        />

        {!isCreate && (
          <View style={{ marginTop: 6 }}>
            <Text style={{ color: t.colors.muted, fontSize: 12 }}>
              Created: {iso(get.data?.createdAt)} • Updated: {iso(get.data?.updatedAt)}
            </Text>
          </View>
        )}

        <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
      </Card>

      {/* Native minimized picker; only mounts when user taps an icon */}
      {picker && (
        <DateTimePicker
          testID="event-datetime"
          mode={picker.mode}
          value={picker.field === "start" ? fromIsoOrNow(startDate) : fromIsoOrNow(endDate)}
          display="default"
          onChange={onChangePicker}
        />
      )}
    </ScrollView>
  );
}

/* ——— Themed bits (same style as clients/events) ——— */

function Card({ children }: { children: React.ReactNode }) {
  const t = useColors();
  return (
    <View
      style={{
        backgroundColor: t.colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.colors.border,
        padding: 16,
        gap: 12,
      }}
    >
      {children}
    </View>
  );
}
function SectionTitle({ title }: { title: string }) {
  const t = useColors();
  return <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>{title}</Text>;
}
function Labeled({ label, children }: React.PropsWithChildren<{ label: string }>) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}
function PrimaryButton({ title, onPress, disabled }: any) {
  const t = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: disabled ? t.colors.disabled : t.colors.primary,
        padding: 14,
        borderRadius: 10,
        alignItems: "center",
        marginTop: 4,
      }}
    >
      <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}
