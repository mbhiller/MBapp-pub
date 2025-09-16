import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { getObject, updateObject } from "../api/client";
import { useTheme } from "../providers/ThemeProvider";
import type { ViewStyle, TextStyle } from "react-native";

type Props = RootStackScreenProps<"RegistrationDetail">;

type Registration = {
  id: string;
  type: "registration";
  eventId?: string;
  accountId?: string;
  status?: string; // e.g., "pending" | "confirmed" | "canceled"
  [k: string]: any;
};

export default function RegistrationDetailScreen({ route, navigation }: Props) {
  const t = useTheme();
  const id = route.params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  // editable fields
  const [eventId, setEventId]       = useState("");
  const [accountId, setAccountId]   = useState("");
  const [status, setStatus]         = useState("pending");

  useEffect(() => {
    let mounted = true;
    if (!id) {
      setLoading(false);
      setErr("Missing registration id");
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const reg = await getObject<Registration>("registration", id);
        if (!mounted) return;
        setEventId(reg?.eventId ?? "");
        setAccountId(reg?.accountId ?? "");
        setStatus(reg?.status ?? "pending");
      } catch (e: any) {
        if (mounted) setErr(e?.message || "Failed to load registration");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [id]);

  async function onSave() {
    if (!id) return;
    setSaving(true);
    try {
      await updateObject("registration", id, {
        type: "registration",
        eventId: eventId || undefined,
        accountId: accountId || undefined,
        status: status || undefined,
      });
      navigation.goBack();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.bg }}>
        <ActivityIndicator />
        {err ? <Text style={{ marginTop: 8, color: t.colors.danger }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
        {err ? <Text style={{ color: t.colors.danger }}>{err}</Text> : null}

        <Text style={{ fontWeight: "700" as const, color: t.colors.text, marginBottom: 8 }}>
          REGISTRATION · {id ?? "—"}
        </Text>

        <Field label="Event ID">
          <TextInput
            value={eventId}
            onChangeText={setEventId}
            placeholder="event id"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
            autoCapitalize="none"
          />
        </Field>

        <Field label="Account ID">
          <TextInput
            value={accountId}
            onChangeText={setAccountId}
            placeholder="account id"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
            autoCapitalize="none"
          />
        </Field>

        <Field label="Status">
          <TextInput
            value={status}
            onChangeText={setStatus}
            placeholder="pending | confirmed | canceled"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
            autoCapitalize="none"
          />
        </Field>

        <TouchableOpacity
          onPress={onSave}
          disabled={saving || !id}
          style={[styles.primaryBtn(t), (saving || !id) && ({ opacity: 0.6 } as ViewStyle)]}
        >
          <Text style={styles.primaryBtnText(t)}>Save</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          disabled={saving}
          style={styles.secondaryBtn(t)}
        >
          <Text style={styles.secondaryBtnText(t)}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{ fontWeight: "600" as const, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}

const styles = {
  input: (t: ReturnType<typeof useTheme>): TextStyle => ({
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: t.colors.card,
    color: t.colors.text,
  }),
  primaryBtn: (t: ReturnType<typeof useTheme>): ViewStyle => ({
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: t.colors.primary,
  }),
  primaryBtnText: (t: ReturnType<typeof useTheme>): TextStyle => ({
    color: t.colors.headerText,
    fontWeight: "700",
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
    fontWeight: "600",
  }),
} as const;
