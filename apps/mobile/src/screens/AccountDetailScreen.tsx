import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Accounts } from "../features/accounts/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { Account } from "../features/accounts/types";

const STATUS_VALUES = ["active", "inactive", "archived"] as const;
type Status = typeof STATUS_VALUES[number];

export default function AccountDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Account>;

  const { data, refetch, isFetching } = Accounts.useGet(id);
  const save = Accounts.useSave();

  const [name, setName] = React.useState(String(initial?.name ?? ""));
  const [number, setNumber] = React.useState(String((initial as any)?.number ?? ""));
  const [currency, setCurrency] = React.useState(String((initial as any)?.currency ?? ""));
  const [accountType, setAccountType] = React.useState(String((initial as any)?.accountType ?? ""));
  const [balance, setBalance] = React.useState(String((initial as any)?.balance ?? ""));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "active"));

  const statusTouched = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      if (id) refetch();
    }, [id, refetch])
  );

  React.useEffect(() => {
    if (!data) return;
    const d = data as Account;

    if (name === "") setName(String(d?.name ?? ""));
    if (number === "") setNumber(String((d as any)?.number ?? ""));
    if (currency === "") setCurrency(String((d as any)?.currency ?? ""));
    if (accountType === "") setAccountType(String((d as any)?.accountType ?? ""));
    if (balance === "") setBalance((d as any)?.balance != null ? String((d as any).balance) : "");

    const serverStatus = String((d as any)?.status ?? "active");
    if (!statusTouched.current) setStatus(serverStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onSave = async () => {
    if (!name.trim()) { Alert.alert("Name is required"); return; }
    const normalized = (status ?? "").trim().toLowerCase();
    const statusEnum: Status = (STATUS_VALUES as readonly string[]).includes(normalized as Status) ? (normalized as Status) : "active";

    const balNum = balance.trim() === "" ? undefined : Number(balance);
    const payload: Partial<Account> = {
      id,
      type: "account",
      name: name.trim(),
      number: number.trim() || undefined,
      currency: currency.trim() || undefined,
      accountType: accountType.trim() || undefined,
      balance: Number.isFinite(balNum as number) ? (balNum as number) : undefined,
      status: statusEnum,
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
        <Field label="Number" value={number} onChangeText={setNumber} />
        <Field label="Currency" value={currency} onChangeText={setCurrency} />
        <Field label="Account type" value={accountType} onChangeText={setAccountType} />
        <Field label="Balance" value={balance} onChangeText={setBalance} keyboardType="numeric" />

        <Label text="Status" />
        <PillGroup options={STATUS_VALUES as unknown as string[]} value={status} onChange={(v) => { statusTouched.current = true; setStatus(v); }} />

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
