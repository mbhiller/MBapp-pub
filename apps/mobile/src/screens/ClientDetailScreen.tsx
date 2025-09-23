import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Clients } from "../features/clients/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { Client } from "../features/clients/types";

const STATUS_VALUES = ["active","inactive","archived"] as const;
type CStatus = typeof STATUS_VALUES[number];

export default function ClientDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Client>;

  const q = Clients.useGet(id);
  const save = Clients.useSave();

  // controlled local state (string-coerced)
  const [name, setName] = React.useState(String((initial as any)?.name ?? ""));
  const [displayName, setDisplayName] = React.useState(String((initial as any)?.displayName ?? ""));
  const [firstName, setFirstName] = React.useState(String((initial as any)?.firstName ?? ""));
  const [lastName, setLastName] = React.useState(String((initial as any)?.lastName ?? ""));
  const [email, setEmail] = React.useState(String((initial as any)?.email ?? ""));
  const [phone, setPhone] = React.useState(String((initial as any)?.phone ?? ""));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "active"));
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));

  const statusTouched = React.useRef(false);

  useFocusEffect(React.useCallback(() => {
    statusTouched.current = false;
    if (id) q.refetch();
  }, [id, q.refetch]));

  // lazy hydrate to avoid clobbering user typing
  React.useEffect(() => {
    const data = q.data as Client | undefined;
    if (!data) return;

    if (name === "") setName(String((data as any)?.name ?? ""));
    if (displayName === "") setDisplayName(String((data as any)?.displayName ?? ""));
    if (firstName === "") setFirstName(String((data as any)?.firstName ?? ""));
    if (lastName === "") setLastName(String((data as any)?.lastName ?? ""));
    if (email === "") setEmail(String((data as any)?.email ?? ""));
    if (phone === "") setPhone(String((data as any)?.phone ?? ""));

    const serverStatus = String((data as any)?.status ?? "active");
    if (!statusTouched.current) setStatus(serverStatus);

    if (notes === "") setNotes(String((data as any)?.notes ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const onSave = async () => {
    if (!name.trim()) { Alert.alert("Name is required"); return; }

    const normalized = (status ?? "").trim();
    const statusEnum: CStatus = (STATUS_VALUES as readonly string[]).includes(normalized as CStatus)
      ? (normalized as CStatus)
      : "active";

    const payload: Partial<Client> = {
      id, type: "client",
      name: name.trim(),
      displayName: displayName.trim() || undefined,
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      status: statusEnum as any,
      notes: notes.trim() || undefined,
    };

    try {
      await save.mutateAsync(payload as any);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    }
  };

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="Display name" value={displayName} onChangeText={setDisplayName} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Field label="First name" value={firstName} onChangeText={setFirstName} /></View>
          <View style={{ flex: 1 }}><Field label="Last name" value={lastName} onChangeText={setLastName} /></View>
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

        <Pressable onPress={onSave}
          style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{id ? "Save" : "Create"}</Text>
        </Pressable>
      </View>
    </FormScreen>
  );
}

function Label({ text }: { text: string }) {
  const t = useColors();
  return <Text style={{ marginBottom: 6, color: t.colors.muted }}>{text}</Text>;
}
function Field({ label, value, onChangeText, multiline, keyboardType }:{
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
          backgroundColor: t.colors.bg, color: t.colors.text,
          borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12,
          minHeight: multiline ? 80 : undefined,
        }}
        placeholderTextColor={t.colors.muted}
      />
    </View>
  );
}
function PillGroup({ options, value, onChange }: { options: string[]; value?: string; onChange: (v: string) => void; }) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.primary : t.colors.card, marginRight: 8, marginBottom: 8,
          }}>
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
