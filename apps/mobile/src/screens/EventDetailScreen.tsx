import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert
} from "react-native";
import type { ViewStyle, TextStyle } from "react-native";
import { useTheme } from "../providers/ThemeProvider";
import type { RootStackScreenProps } from "../navigation/types";
import { createEvent, getEvent, updateEvent } from "../features/events/api";

type Props = RootStackScreenProps<"EventDetail">;

export default function EventDetailScreen({ route, navigation }: Props) {
  const t = useTheme();
  const id = route?.params?.id;
  const isCreate = route?.params?.mode === "new" || !id;

  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isCreate && id) {
      (async () => {
        try {
          setLoading(true);
          const e = await getEvent(id);
          setName(e.name ?? "");
          setStartsAt(e.startsAt ?? "");
          setEndsAt(e.endsAt ?? "");
          setStatus(e.status ?? "");
        } catch (ex: any) {
          setErr(ex?.message || String(ex));
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [id, isCreate]);

  async function onSave() {
    try {
      setSaving(true);
      const payload = {
        name,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        status: status || undefined,
      };
      if (isCreate) {
        const created = await createEvent(payload);
        Alert.alert("Saved", "Event created");
        navigation.replace("EventDetail", { id: created.id });
      } else if (id) {
        await updateEvent(id, payload);
        Alert.alert("Saved", "Event updated");
      }
    } catch (ex: any) {
      Alert.alert("Error", ex?.message || String(ex));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1 }}
    >
      <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ padding: 14 }}>
        {loading ? <ActivityIndicator /> : null}
        {err ? <Text style={{ color: t.colors.danger, marginBottom: 8 }}>{err}</Text> : null}

        <Text style={{ color: t.colors.text, marginBottom: 6 }}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Spring Classic"
          placeholderTextColor={t.colors.textMuted}
          style={styles.input(t)}
        />

        <Text style={{ color: t.colors.text, marginVertical: 6 }}>Starts At (ISO)</Text>
        <TextInput
          value={startsAt}
          onChangeText={setStartsAt}
          placeholder="2025-11-26T09:00:00Z"
          placeholderTextColor={t.colors.textMuted}
          style={styles.input(t)}
        />

        <Text style={{ color: t.colors.text, marginVertical: 6 }}>Ends At (ISO)</Text>
        <TextInput
          value={endsAt}
          onChangeText={setEndsAt}
          placeholder="2025-11-30T16:00:00Z"
          placeholderTextColor={t.colors.textMuted}
          style={styles.input(t)}
        />

        <Text style={{ color: t.colors.text, marginVertical: 6 }}>Status</Text>
        <TextInput
          value={status}
          onChangeText={setStatus}
          placeholder="draft | published | closed"
          placeholderTextColor={t.colors.textMuted}
          style={styles.input(t)}
        />

        <TouchableOpacity disabled={saving} onPress={onSave} style={styles.primaryBtn(t)}>
          <Text style={styles.primaryBtnText(t)}>{isCreate ? "Create" : "Save"}</Text>
        </TouchableOpacity>

        {!isCreate && id ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("RegistrationsList", { eventId: id, eventName: name })}
            style={styles.secondaryBtn(t)}
          >
            <Text style={styles.secondaryBtnText(t)}>View Registrations</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = {
  input: (t: ReturnType<typeof useTheme>): TextStyle => ({
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.card,
    padding: 10,
    borderRadius: 10,
    color: t.colors.text,
  }),
  primaryBtn: (t: ReturnType<typeof useTheme>): ViewStyle => ({
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: t.colors.primary,
  }),
  primaryBtnText: (t: ReturnType<typeof useTheme>): TextStyle => ({
    color: t.colors.headerText,
    fontWeight: "700" as TextStyle["fontWeight"],
  }),
  secondaryBtn: (t: ReturnType<typeof useTheme>): ViewStyle => ({
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: t.colors.card,
    borderWidth: 1,
    borderColor: t.colors.border,
  }),
  secondaryBtnText: (t: ReturnType<typeof useTheme>): TextStyle => ({
    color: t.colors.text,
    fontWeight: "700" as TextStyle["fontWeight"],
  }),
} as const;
