// apps/mobile/src/screens/AccountDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Accounts } from "../features/accounts/hooks";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { Account } from "../features/accounts/types";

const STATUS_VALUES = ["active", "inactive", "archived"] as const;
type Status = typeof STATUS_VALUES[number];

// ✅ Fixed choices → PillGroup
const ACCOUNT_TYPE_VALUES = ["asset","liability","revenue","expense","equity"] as const;
type AccountType = typeof ACCOUNT_TYPE_VALUES[number];

export default function AccountDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const initial = (route?.params?.initial ?? {}) as Partial<Account>;

  const { data, refetch, isFetching } = Accounts.useGet(id);
  const save = Accounts.useSave();

  const [name, setName] = React.useState(String(initial?.name ?? ""));
  const [number, setNumber] = React.useState(String((initial as any)?.number ?? ""));
  const [currency, setCurrency] = React.useState(String((initial as any)?.currency ?? ""));
  const [accountType, setAccountType] = React.useState<string>(String((initial as any)?.accountType ?? "")); // pill state
  const [balance, setBalance] = React.useState(String((initial as any)?.balance ?? ""));
  const [status, setStatus] = React.useState<string>(String((initial as any)?.status ?? "active"));

  const statusTouched = React.useRef(false);
  const typeTouched = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      statusTouched.current = false;
      typeTouched.current = false;
      if (id) refetch();
    }, [id, refetch])
  );

  React.useEffect(() => {
    if (!data) return;
    const d = data as Account;

    if (name === "") setName(String(d?.name ?? ""));
    if (number === "") setNumber(String((d as any)?.number ?? ""));
    if (currency === "") setCurrency(String((d as any)?.currency ?? ""));
    if (!typeTouched.current) setAccountType(String((d as any)?.accountType ?? "")); // hydrate pill from server
    if (balance === "") setBalance((d as any)?.balance != null ? String((d as any).balance) : "");

    const serverStatus = String((d as any)?.status ?? "active");
    if (!statusTouched.current) setStatus(serverStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onSave = async () => {
    if (!name.trim()) { Alert.alert("Name is required"); return; }

    // normalize to unions
    const normalizedStatus = (status ?? "").trim().toLowerCase();
    const statusEnum: Status =
      (STATUS_VALUES as readonly string[]).includes(normalizedStatus as Status)
        ? (normalizedStatus as Status)
        : "active";

    const normalizedType = (accountType ?? "").trim().toLowerCase();
    const accountTypeEnum: AccountType | undefined =
      (ACCOUNT_TYPE_VALUES as readonly string[]).includes(normalizedType as AccountType)
        ? (normalizedType as AccountType)
        : undefined;

    const balNum = balance.trim() === "" ? undefined : Number(balance);

    const payload: Partial<Account> = {
      id,
      type: "account",
      name: name.trim(),
      number: number.trim() || undefined,
      currency: currency.trim() || undefined,
      accountType: accountTypeEnum, // ✅ union-safe
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

        {/* ✅ PillGroup for account type */}
        <Label text="Account Type" />
        <PillGroup
          options={ACCOUNT_TYPE_VALUES as unknown as string[]}
          value={accountType}
          onChange={(v) => { typeTouched.current = true; setAccountType(v); }}
        />

        <Field label="Balance" value={balance} onChangeText={setBalance} keyboardType="numeric" />

        <Label text="Status" />
        <PillGroup
          options={STATUS_VALUES as unknown as string[]}
          value={status}
          onChange={(v) => { statusTouched.current = true; setStatus(v); }}
        />

        <Pressable onPress={onSave} style={{ marginTop: 12, backgroundColor: t.colors.primary, padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {id ? (isFetching ? "Saving…" : "Save") : "Create"}
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
        // optional: pretty label
        const label = opt.charAt(0).toUpperCase() + opt.slice(1);
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.primary : t.colors.card, marginRight: 8, marginBottom: 8,
          }}>
            <Text style={{ color: selected ? t.colors.buttonText : t.colors.text, fontWeight: "600" }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
