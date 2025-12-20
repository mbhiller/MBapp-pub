// apps/mobile/src/screens/ReservationDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert, ScrollView } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { createObject, getObject, updateObject, deleteObject } from "../api/client";
import type { components } from "../api/generated-types";
import { holdReservation, confirmReservation, releaseReservation, reassignReservation } from "../features/reservations/actions";

type Reservation = components["schemas"]["Reservation"];
type Route = RouteProp<RootStackParamList, "ReservationDetail">;

type RootStackParamList = {
  ReservationDetail: { id?: string; mode?: "new" | "edit"; initial?: Partial<Reservation> };
};

export default function ReservationDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const t = useColors();
  const id = params?.id;
  const mode = params?.mode as "new" | "edit" | undefined;
  const isNew = mode === "new" || !id;

  const [model, setModel] = React.useState<Partial<Reservation>>(
    params?.initial ?? ({ type: "reservation", status: "pending" } as Partial<Reservation>)
  );

  const load = React.useCallback(async () => {
    if (!id) return;
    const res = (await getObject("reservation", id)) as Reservation;
    setModel(res);
  }, [id]);

  React.useEffect(() => { if (!isNew) load(); }, [load, isNew]);

  const onSave = React.useCallback(async () => {
    const payload: Partial<Reservation> = {
      type: "reservation",
      resourceId: model.resourceId!,
      resourceName: (model as any).resourceName ?? null,
      clientId: model.clientId!,
      clientName: model.clientName ?? null,
      startsAt: model.startsAt || new Date().toISOString(),
      endsAt: (model as any).endsAt ?? null,
      status: model.status || "pending",
    } as any;

    if (isNew) {
      const created = (await createObject<Reservation>("reservation", payload)) as Reservation;
      navigation.replace("ReservationDetail", { id: created.id, mode: "edit" });
    } else if (id) {
      await updateObject("reservation", id, payload);
      await load();
    }
  }, [id, isNew, model, load, navigation]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <View style={{ marginBottom: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 18 }}>
          {isNew ? "New Reservation" : (model as any).resourceName || "Reservation"}
        </Text>
        <Pressable
          onPress={onSave}
          style={{ backgroundColor: t.colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }}
        >
          <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
            {isNew ? "Create" : "Save"}
          </Text>
        </Pressable>
      </View>

      <View style={{ gap: 12 }}>
        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Resource Name</Text>
        <TextInput
          value={(model as any).resourceName || ""}
          onChangeText={(v) => setModel({ ...model, resourceName: v } as any)}
          placeholder="Resource name"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Client Name</Text>
        <TextInput
          value={model.clientName || ""}
          onChangeText={(v) => setModel({ ...model, clientName: v })}
          placeholder="Client name"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />

        {!isNew && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <Pressable onPress={async () => { if (!id) return; await holdReservation(id); await load(); }}
              style={{ backgroundColor: t.colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
              <Text style={{ color: t.colors.text }}>Hold</Text>
            </Pressable>
            <Pressable onPress={async () => { if (!id) return; await confirmReservation(id); await load(); }}
              style={{ backgroundColor: t.colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
              <Text style={{ color: t.colors.text }}>Confirm</Text>
            </Pressable>
            <Pressable onPress={async () => { if (!id) return; await releaseReservation(id); await load(); }}
              style={{ backgroundColor: t.colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
              <Text style={{ color: t.colors.text }}>Release</Text>
            </Pressable>
            <Pressable onPress={async () => { if (!id) return; await deleteObject("reservation", id); navigation.goBack(); }}
              style={{ backgroundColor: t.colors.danger, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
              <Text style={{ color: t.colors.buttonText }}>Delete</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
