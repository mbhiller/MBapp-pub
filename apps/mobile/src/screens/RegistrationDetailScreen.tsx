// apps/mobile/src/screens/RegistrationDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert, ScrollView } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { createObject, getObject, updateObject, deleteObject } from "../api/client";
import type { components } from "../api/generated-types";
import { registerRegistration, cancelRegistration, checkinRegistration } from "../features/registrations/actions";

type Registration = components["schemas"]["Registration"];
type Route = RouteProp<RootStackParamList, "RegistrationDetail">;

type RootStackParamList = {
  RegistrationDetail: { id?: string; mode?: "new" | "edit"; initial?: Partial<Registration> };
};

export default function RegistrationDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const t = useColors();
  const id = params?.id;
  const mode = params?.mode as "new" | "edit" | undefined;
  const isNew = mode === "new" || !id;

  const [model, setModel] = React.useState<Partial<Registration>>(
    params?.initial ?? ({ type: "registration", status: "pending" } as Partial<Registration>)
  );
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = (await getObject("registration", id)) as Registration;
    setModel(res);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    if (!isNew) load();
  }, [load, isNew]);

  const onSave = React.useCallback(async () => {
    const payload: Partial<Registration> = {
      type: "registration",
      eventId: model.eventId!,
      clientId: model.clientId!,
      clientName: model.clientName ?? null,
      qty: (model as any).qty ?? 1,
      status: model.status || "pending",
      checkedInAt: (model as any).checkedInAt ?? null,
    } as any;

    if (isNew) {
      const created = (await createObject<Registration>("registration", payload)) as Registration;
      navigation.replace("RegistrationDetail", { id: created.id, mode: "edit" });
    } else if (id) {
      await updateObject("registration", id, payload);
      await load();
    }
  }, [id, isNew, model, load, navigation]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <View style={{ marginBottom: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 18 }}>
          {isNew ? "New Registration" : model.clientName || "Registration"}
        </Text>
        <Pressable
          onPress={onSave}
          style={{
            backgroundColor: t.colors.primary,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {isNew ? "Create" : "Save"}
          </Text>
        </Pressable>
      </View>

      <View style={{ gap: 12 }}>
        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Client Name</Text>
        <TextInput
          value={model.clientName || ""}
          onChangeText={(v) => setModel({ ...model, clientName: v })}
          placeholder="Client name"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Qty</Text>
        <TextInput
          value={String((model as any).qty ?? 1)}
          onChangeText={(v) => setModel({ ...model, qty: v ? Number(v) : 1 } as any)}
          keyboardType="numeric"
          placeholder="e.g. 1"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />

        {!isNew && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={async () => { if (!id) return; await registerRegistration(id); await load(); }}
              style={{ backgroundColor: t.colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
            >
              <Text style={{ color: t.colors.text }}>Register</Text>
            </Pressable>
            <Pressable
              onPress={async () => { if (!id) return; await checkinRegistration(id); await load(); }}
              style={{ backgroundColor: t.colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
            >
              <Text style={{ color: t.colors.text }}>Check in</Text>
            </Pressable>
            <Pressable
              onPress={async () => { if (!id) return; await cancelRegistration(id); await load(); }}
              style={{ backgroundColor: t.colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
            >
              <Text style={{ color: t.colors.text }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={async () => { if (!id) return; await deleteObject("registration", id); navigation.goBack(); }}
              style={{ backgroundColor: t.colors.danger, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
            >
              <Text style={{ color: t.colors.buttonText }}>Delete</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
