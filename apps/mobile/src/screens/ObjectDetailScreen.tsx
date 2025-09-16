// apps/mobile/src/screens/ObjectDetailScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import type { RootStackScreenProps } from "../navigation/types";
import { getObject, updateObject, type MbObject } from "../api/client";
import { useTheme } from "../providers/ThemeProvider";
import type { ViewStyle, TextStyle } from "react-native";

type Props = RootStackScreenProps<"ObjectDetail">;

export default function ObjectDetailScreen({ route, navigation }: Props) {
  const t = useTheme();

  // route.params can be undefined; make it safe and provide defaults
  const type = route.params?.type ?? "horse";
  const id   = route.params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const [name, setName] = useState("");

  useEffect(() => {
    let mounted = true;

    // If id is missing, show a friendly error
    if (!id) {
      setLoading(false);
      setErr("Missing object id");
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const o = await getObject<MbObject>(type, id);
        if (!mounted) return;
        setName(o?.name ?? "");
      } catch (e: any) {
        if (mounted) setErr(e?.message || "Failed to load");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [type, id]);

  async function onSave() {
    if (!id) return; // safety
    setSaving(true);
    try {
      await updateObject(type, id, { name: name || undefined });
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
          {type.toUpperCase()} · {id ?? "—"}
        </Text>

        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={t.colors.textMuted}
            style={styles.input(t)}
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
