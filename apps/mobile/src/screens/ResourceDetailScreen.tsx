// apps/mobile/src/screens/ResourceDetailScreen.tsx
import React from "react";
import { View, Text, TextInput, Pressable, ScrollView } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { createObject, getObject, updateObject, deleteObject } from "../api/client";
import type { components } from "../api/generated-types";

type Resource = components["schemas"]["Resource"];
type Route = RouteProp<RootStackParamList, "ResourceDetail">;

type RootStackParamList = {
  ResourceDetail: { id?: string; mode?: "new" | "edit"; initial?: Partial<Resource> };
};

export default function ResourceDetailScreen({ navigation }: any) {
  const { params } = useRoute<Route>();
  const t = useColors();
  const id = params?.id;
  const mode = params?.mode as "new" | "edit" | undefined;
  const isNew = mode === "new" || !id;

  const [model, setModel] = React.useState<Partial<Resource>>(
    params?.initial ?? ({ type: "resource", status: "available" } as Partial<Resource>)
  );

  const load = React.useCallback(async () => {
    if (!id) return;
    const res = (await getObject("resource", id)) as Resource;
    setModel(res);
  }, [id]);

  React.useEffect(() => { if (!isNew) load(); }, [load, isNew]);

  const onSave = React.useCallback(async () => {
    const payload: Partial<Resource> = {
      type: "resource",
      name: model.name || "",
      resourceType: (model as any).resourceType ?? "stall",
      status: model.status || "available",
    } as any;

    if (isNew) {
      const created = (await createObject<Resource>("resource", payload)) as Resource;
      navigation.replace("ResourceDetail", { id: created.id, mode: "edit" });
    } else if (id) {
      await updateObject("resource", id, payload);
      await load();
    }
  }, [id, isNew, model, load, navigation]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <View style={{ marginBottom: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 18 }}>
          {isNew ? "New Resource" : model.name || "Resource"}
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
        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Name</Text>
        <TextInput
          value={model.name || ""}
          onChangeText={(v) => setModel({ ...model, name: v })}
          placeholder="Resource name"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Type</Text>
        <TextInput
          value={(model as any).resourceType || ""}
          onChangeText={(v) => setModel({ ...model, resourceType: v } as any)}
          placeholder="stall / rv / arena / equipment"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />

        <Text style={{ color: t.colors.text, fontWeight: "600" }}>Status</Text>
        <TextInput
          value={model.status || "available"}
          onChangeText={(v) => setModel({ ...model, status: v as any })}
          placeholder="available / maintenance / unavailable"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />

        {!isNew && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <Pressable onPress={async () => { if (!id) return; await deleteObject("resource", id); navigation.goBack(); }}
              style={{ backgroundColor: t.colors.danger, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
              <Text style={{ color: t.colors.buttonText }}>Delete</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
