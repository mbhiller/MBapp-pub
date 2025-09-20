import React from "react";
import { ScrollView, View, Text, TextInput, Pressable, Alert } from "react-native";
import { Clients } from "../features/clients/hooks";
import { useColors } from "../providers/useColors";

function iso(d?: string) { return d ? new Date(d).toLocaleString() : "—"; }

export default function ClientDetailScreen({ route, navigation }: any) {
  const id: string | undefined = route?.params?.id;
  const isCreate = !id;

  const t = useColors();
  const get = Clients.useGet(id);
  const create = Clients.useCreate();
  const update = id ? Clients.useUpdate(id) : undefined;

  const [name, setName]   = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");

  // hydrate on load/edit
  React.useEffect(() => {
    if (isCreate) {
      setName(""); setEmail(""); setPhone("");
      return;
    }
    if (get.data) {
      setName(get.data.name ?? "");
      setEmail(get.data.email ?? "");
      setPhone(get.data.phone ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get.data?.id]);

  const saving = Boolean(update?.isPending || create.isPending);

  const onSave = async () => {
    const trimmed = {
      name:  name?.trim() || undefined,
      email: email?.trim() || undefined,
      phone: phone?.trim() || undefined,
    };
    if (!trimmed.name) {
      Alert.alert("Validation", "Client name is required.");
      return;
    }
    try {
      if (id && update) {
        await update.mutateAsync(trimmed);
        Alert.alert("Saved", "Client updated.");
        navigation.goBack();
      } else {
        await create.mutateAsync(trimmed);
        Alert.alert("Saved", "Client created.");
        navigation.navigate("ClientsList");
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Unknown error");
    }
  };

  if (id && get.isLoading) {
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.colors.background }}>
        <Text style={{ color: t.colors.muted }}>Loading…</Text>
      </View>
    );
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.colors.text,
    backgroundColor: t.colors.background,
  } as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Card>
        <SectionTitle title={isCreate ? "New Client" : "Edit Client"} />

        <Labeled label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Client name"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            autoCapitalize="words"
          />
        </Labeled>

        <Labeled label="Email">
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </Labeled>

        <Labeled label="Phone">
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            placeholderTextColor={t.colors.muted}
            style={inputStyle}
            keyboardType="phone-pad"
          />
        </Labeled>

        {!isCreate && (
          <View style={{ marginTop: 6 }}>
            <Text style={{ color: t.colors.muted, fontSize: 12 }}>
              Created: {iso(get.data?.createdAt)} • Updated: {iso(get.data?.updatedAt)}
            </Text>
          </View>
        )}

        <PrimaryButton title={saving ? "Saving…" : "Save"} disabled={saving} onPress={onSave} />
      </Card>
    </ScrollView>
  );
}

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
