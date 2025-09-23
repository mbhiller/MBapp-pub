import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Employees } from "../features/employees/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import DateTimeField from "../features/_shared/DateTimeField";
import type { Employee } from "../features/employees/types";

const STATUS_VALUES = ["active", "inactive", "terminated"] as const;
type Status = typeof STATUS_VALUES[number];

export default function EmployeeDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Employee>;

  const { data, refetch, isFetching } = Employees.useGet(id);
  const save = Employees.useSave();

  // String-controlled local state
  const [displayName, setDisplayName] = React.useState(String((initial as any)?.displayName ?? String((initial as any)?.name ?? "")));
  const [email, setEmail] = React.useState(String((initial as any)?.email ?? ""));
  const [phone, setPhone] = React.useState(String((initial as any)?.phone ?? ""));
  const [role, setRole] = React.useState(String((initial as any)?.role ?? ""));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "active"));
  const [hiredAt, setHiredAt] = React.useState<string | undefined>((initial as any)?.hiredAt ?? (initial as any)?.startDate ?? undefined);
  const [terminatedAt, setTerminatedAt] = React.useState<string | undefined>((initial as any)?.terminatedAt ?? undefined);
  const [notes, setNotes] = React.useState(String((initial as any)?.notes ?? ""));

  const statusTouched = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      if (id) refetch();
    }, [id, refetch])
  );

  React.useEffect(() => {
    if (!data) return;
    const d = data as Employee;

    if (displayName === "") setDisplayName(String((d as any)?.displayName ?? (d as any)?.name ?? ""));
    if (email === "") setEmail(String((d as any)?.email ?? ""));
    if (phone === "") setPhone(String((d as any)?.phone ?? ""));
    if (role === "") setRole(String((d as any)?.role ?? ""));
    if (!hiredAt && ((d as any)?.hiredAt || (d as any)?.startDate)) setHiredAt((d as any)?.hiredAt ?? (d as any)?.startDate);
    if (!terminatedAt && (d as any)?.terminatedAt) setTerminatedAt((d as any).terminatedAt);
    if (notes === "") setNotes(String((d as any)?.notes ?? ""));

    const serverStatus = String((d as any)?.status ?? "active");
    if (!statusTouched.current) setStatus(serverStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onSave = async () => {
    if (!displayName.trim()) { Alert.alert("Display name is required"); return; }

    const normalized = (status ?? "").trim().toLowerCase();
    const statusEnum: Status = (STATUS_VALUES as readonly string[]).includes(normalized as Status) ? (normalized as Status) : "active";

    const payload: Partial<Employee> = {
      id,
      type: "employee",
      displayName: displayName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      role: role.trim() || undefined,
      status: statusEnum,
      hiredAt,
      startDate: hiredAt, // keep alias in payload for server normalization
      terminatedAt,
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
        <Field label="Display name *" value={displayName} onChangeText={setDisplayName} />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="Role" value={role} onChangeText={setRole} />

        <Label text="Status" />
        <PillGroup options={STATUS_VALUES as unknown as string[]} value={status} onChange={(v) => { statusTouched.current = true; setStatus(v); }} />

        <DateTimeField label="Hired at" value={hiredAt} onChange={setHiredAt} mode="date" />
        <DateTimeField label="Terminated at" value={terminatedAt} onChange={setTerminatedAt} mode="date" />

        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Pressable onPress={onSave} style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{id ? (isFetching ? "Saving…" : "Save") : "Create"}</Text>
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
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: multiline ? 80 : undefined }}
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
          <Pressable key={opt} onPress={() => onChange(opt)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: selected ? t.colors.primary : t.colors.border, backgroundColor: selected ? t.colors.primary : t.colors.card, marginRight: 8, marginBottom: 8 }}>
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
