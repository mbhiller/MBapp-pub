// apps/mobile/src/screens/EventDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, Alert, ScrollView } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { createObject, getObject, updateObject, deleteObject } from "../api/client";
import type { components } from "../api/generated-types";
import {
  publishEvent,
  archiveEvent,
  cancelEvent,
  updateEventCapacity,
} from "../features/events/actions";

type Event = components["schemas"]["Event"];
type Route = RouteProp<RootStackParamList, "EventDetail">;

type RootStackParamList = {
  EventDetail: { id?: string; mode?: "new" | "edit"; initial?: Partial<Event> };
};

export default function EventDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const t = useColors();
  const id = params?.id;
  const mode = params?.mode as "new" | "edit" | undefined;
  const isNew = mode === "new" || !id;

  const [model, setModel] = React.useState<Partial<Event>>(
    params?.initial ?? ({ type: "event", status: "draft" } as Partial<Event>)
  );
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = (await getObject("event", id)) as Event;
    setModel(res);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    if (!isNew) load();
  }, [load, isNew]);

  const onSave = React.useCallback(async () => {
    const payload: Partial<Event> = {
      type: "event",
      name: model.name || "",
      description: (model as any).description ?? null,
      location: (model as any).location ?? null,
      startsAt: model.startsAt || new Date().toISOString(),
      endsAt: (model as any).endsAt ?? null,
      status: model.status || "draft",
      capacity: (model as any).capacity ?? null,
    } as any;

    if (isNew) {
      const created = (await createObject<Event>("event", payload)) as Event;
      navigation.replace("EventDetail", { id: created.id, mode: "edit" });
    } else if (id) {
      await updateObject("event", id, payload);
      await load();
    }
  }, [id, isNew, model, load, navigation]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <View style={{ marginBottom: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 18 }}>
          {isNew ? "New Event" : model.name || "Event"}
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
        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Name</Text>
        <TextInput
          value={model.name || ""}
          onChangeText={(v) => setModel({ ...model, name: v })}
          placeholder="Event name"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 10,
            color: t.colors.text,
          }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Status</Text>
        <TextInput
          value={model.status || "draft"}
          onChangeText={(v) => setModel({ ...model, status: v as any })}
          placeholder="draft/scheduled/open/..."
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 10,
            color: t.colors.text,
          }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Starts At</Text>
        <TextInput
          value={model.startsAt || ""}
          onChangeText={(v) => setModel({ ...model, startsAt: v })}
          placeholder="YYYY-MM-DDTHH:mm:ssZ"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 10,
            color: t.colors.text,
          }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Ends At</Text>
        <TextInput
          value={(model as any).endsAt || ""}
          onChangeText={(v) => setModel({ ...model, endsAt: v as any })}
          placeholder="YYYY-MM-DDTHH:mm:ssZ"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 10,
            color: t.colors.text,
          }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Capacity</Text>
        <TextInput
          value={
            typeof (model as any).capacity === "number"
              ? String((model as any).capacity)
              : ""
          }
          onChangeText={(v) => setModel({ ...model, capacity: v ? Number(v) : null } as any)}
          keyboardType="numeric"
          placeholder="e.g. 100"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 10,
            color: t.colors.text,
          }}
        />

        {/* Action row (⋮ equivalents) */}
        {!isNew && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={async () => {
                if (!id) return;
                await publishEvent(id);
                await load();
              }}
              style={{
                backgroundColor: t.colors.card,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: t.colors.text }}>Publish</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                if (!id) return;
                await cancelEvent(id);
                await load();
              }}
              style={{
                backgroundColor: t.colors.card,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: t.colors.text }}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                if (!id) return;
                const c =
                  typeof (model as any).capacity === "number"
                    ? (model as any).capacity + 5
                    : 0;
                await updateEventCapacity(id, c);
                await load();
              }}
              style={{
                backgroundColor: t.colors.card,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: t.colors.text }}>+5 Capacity</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                if (!id) return;
                await archiveEvent(id);
                await load();
              }}
              style={{
                backgroundColor: t.colors.card,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: t.colors.text }}>Archive</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                if (!id) return;
                await deleteObject("event", id);
                navigation.goBack();
              }}
              style={{
                backgroundColor: t.colors.danger,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: t.colors.buttonText }}>Delete</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
