// apps/mobile/src/screens/ClientDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Clients } from "../features/clients/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { Client } from "../features/clients/types";

const STATUS_VALUES = ["active", "inactive", "archived"] as const;
type Status = typeof STATUS_VALUES[number];

export default function ClientDetailScreen({ route, navigation }: any) {
  const t = useColors();

  const id: string | undefined = route?.params?.id;
  const mode: "new" | "edit" | undefined = route?.params?.mode;
  const isNew = mode === "new" || !id;

  const initial = (route?.params?.initial ?? {}) as Partial<Client>;

  // hooks (mirror Products pattern)
  const detail = Clients.useGet(isNew ? undefined : id);
  const save   = Clients.useSave();
  const [saving, setSaving] = React.useState(false);

  // local controlled state
  const [name, setName]                 = React.useState(String((initial as any)?.name ?? ""));
  const [displayName, setDisplayName]   = React.useState(String((initial as any)?.displayName ?? ""));
  const [firstName, setFirstName]       = React.useState(String((initial as any)?.firstName ?? ""));
  const [lastName, setLastName]         = React.useState(String((initial as any)?.lastName ?? ""));
  const [email, setEmail]               = React.useState(String((initial as any)?.email ?? ""));
  const [phone, setPhone]               = React.useState(String((initial as any)?.phone ?? ""));
  const [status, setStatus]             = React.useState<string>(String((initial as any)?.status ?? "active"));
  const [notes, setNotes]               = React.useState(String((initial as any)?.notes ?? ""));

  // “touched” flag to avoid clobbering pills with server value after user changes them
  const statusTouched = React.useRef(false);

  // refetch on focus (do NOT clear local state)
  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      if (!isNew && id) detail.refetch();
    }, [isNew, id, detail.refetch])
  );

  // merge server data into still-empty fields; status hydrates unless touched
  React.useEffect(() => {
    const data = detail.data as Client | undefined;
    if (!data) return;

    if (name === "")        setName(String((data as any)?.name ?? ""));
    if (displayName === "") setDisplayName(String((data as any)?.displayName ?? ""));
    if (firstName === "")   setFirstName(String((data as any)?.firstName ?? ""));
    if (lastName === "")    setLastName(String((data as any)?.lastName ?? ""));
    if (email === "")       setEmail(String((data as any)?.email ?? ""));
    if (phone === "")       setPhone(String((data as any)?.phone ?? ""));
    if (notes === "")       setNotes(String((data as any)?.notes ?? ""));

    const serverStatus = String((data as any)?.status ?? "active");
    if (!statusTouched.current) setStatus(serverStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  const onSave = async () => {
    if (!name.trim()) { Alert.alert("Name is required"); return; }
    setSaving(true);

    const normalized = (status ?? "").trim().toLowerCase();
    const statusEnum: Status = (STATUS_VALUES as readonly string[]).includes(normalized as Status)
      ? (normalized as Status)
      : "active";

    const payload: Partial<Client> = {
      ...(isNew ? {} : { id }),
      type: "client",
      name: name.trim(),
      displayName: displayName.trim() || undefined,
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      status: statusEnum,
      notes: notes.trim() || undefined,
    };

    try {
      await save.mutateAsync(payload as any);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormScreen>
      <View
        style={{
          backgroundColor: t.colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="Display name" value={displayName} onChangeText={setDisplayName} />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="First name" value={firstName} onChangeText={setFirstName} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Last name" value={lastName} onChangeText={setLastName} />
          </View>
        </View>

        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        <Label text="Status" />
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable
          onPress={onSave}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}

function Field({
  label, value, onChangeText, multiline, keyboardType,
}:{
  label: string; value?: any; onChangeText: (v: any) => void; multiline?: boolean; keyboardType?: any;
}) {
  const t = useColors();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ marginBottom: 6, color: t.colors.muted }}>{label}</Text>
      <TextInput
        value={String(value ?? "")}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        returnKeyType="done"
        style={{
          backgroundColor: t.colors.bg,
          color: t.colors.text,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}

function PillGroup({
  options, value, onChange,
}: { options: string[]; value?: string; onChange: (v: string) => void; }) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
              borderColor: selected ? t.colors.primary : t.colors.border,
              backgroundColor: selected ? t.colors.primary : t.colors.card,
              marginRight: 8, marginBottom: 8,
            }}
          >
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
