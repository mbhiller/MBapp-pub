// apps/mobile/src/screens/VendorDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Vendors } from "../features/vendors/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { Vendor } from "../features/vendors/types";

const STATUS_VALUES = ["active","inactive","archived"] as const;
type VStatus = typeof STATUS_VALUES[number];

export default function VendorDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const mode: "new" | "edit" | undefined = route?.params?.mode;
  const isNew = mode === "new" || !id;

  const initial = (route?.params?.initial ?? {}) as Partial<Vendor>;

  // If your hooks lib has useCreate/useUpdate, you can swap them in like Products.
  const detail = Vendors.useGet(isNew ? undefined : id);
  const save   = Vendors.useSave();
  const [saving, setSaving] = React.useState(false);

  const [name, setName]           = React.useState(String((initial as any)?.name ?? ""));
  const [displayName, setDisplayName] = React.useState(String((initial as any)?.displayName ?? ""));
  const [email, setEmail]         = React.useState(String((initial as any)?.email ?? ""));
  const [phone, setPhone]         = React.useState(String((initial as any)?.phone ?? ""));
  const [status, setStatus]       = React.useState<string>(String((initial as any)?.status ?? "active"));
  const [notes, setNotes]         = React.useState(String((initial as any)?.notes ?? ""));

  const statusTouched = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      if (!isNew && id) detail.refetch();
    }, [isNew, id, detail.refetch])
  );

  React.useEffect(() => {
    const data = detail.data as Vendor | undefined;
    if (!data) return;

    if (name === "")        setName(String((data as any)?.name ?? ""));
    if (displayName === "") setDisplayName(String((data as any)?.displayName ?? ""));
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

    const normalized = (status ?? "").trim();
    const statusEnum: VStatus = (STATUS_VALUES as readonly string[]).includes(normalized as VStatus)
      ? (normalized as VStatus) : "active";

    const payload: Partial<Vendor> = {
      ...(isNew ? {} : { id }),
      type: "vendor",
      name: name.trim(),
      displayName: displayName.trim() || undefined,
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormScreen>
      <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 16 }}>
        <Field label="Name *" value={name} onChangeText={setName} />
        <Field label="Display Name" value={displayName} onChangeText={setDisplayName} />
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
function PillGroup({ options, value, onChange }:{ options: string[]; value?: string; onChange: (v: string) => void; }) {
  const t = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = String(value ?? "") === opt;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.primary : t.colors.card,
            marginRight: 8, marginBottom: 8,
          }}>
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
