import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import FormScreen from "../features/_shared/FormScreen";
import type { RootStackParamList } from "../navigation/types";
import { createParty, addPartyRole, getParty, Party } from "../features/parties/api";

type Route = RouteProp<RootStackParamList, "PartyDetail">;

export default function PartyDetailScreen({ navigation }: any) {
  const t = useColors();
  const { params } = useRoute<Route>();
  const id = params?.id as string | undefined;
  const isNew = !id;

  const [snap, setSnap] = useState<Partial<Party>>({ kind: "person", name: "" });

  async function load() {
    if (!id) return;
    const res = await getParty(id);
    setSnap(res);
  }
  useEffect(() => { load(); }, [id]);

  async function save() {
    try {
      if (isNew) {
        const p = await createParty({ kind: (snap.kind as any) ?? "person", name: String(snap.name ?? "").trim() });
        Alert.alert("Saved", `Party ${p.name} created`);
        navigation.replace("PartyDetail", { id: p.id });
      } else {
        Alert.alert("Saved", "No updates implemented yet (rename, etc.)");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    }
  }

  async function addRole(role: string) {
    if (!id) return;
    await addPartyRole(id, role);
    Alert.alert("Role added", role);
    load();
  }

  return (
    <FormScreen title={isNew ? "New Party" : "Party"} onSave={save}>
      <View style={{ gap: 10 }}>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Name</Text>
        <TextInput
          value={snap.name ?? ""}
          onChangeText={(v)=> setSnap(s => ({ ...s, name: v }))}
          placeholder="Name"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 8 }}>Kind</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["person","org"] as const).map(k => (
            <Pressable key={k} onPress={()=> setSnap(s=> ({...s, kind: k}))} style={{ padding: 8, borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, backgroundColor: snap.kind===k ? t.colors.card : "transparent" }}>
              <Text style={{ color: t.colors.text }}>{k}</Text>
            </Pressable>
          ))}
        </View>

        {!isNew && (
          <>
            <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 12 }}>Quick Roles</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {["customer","vendor","employee","trainer","owner","lessor","lessee"].map(r => (
                <Pressable key={r} onPress={()=> addRole(r)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: t.colors.border }}>
                  <Text style={{ color: t.colors.text }}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
    </FormScreen>
  );
}
