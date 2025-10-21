import React, { useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { findParties, Party } from "../features/parties/api";

export default function PartyListScreen({ navigation }: any) {
  const t = useColors();
  const [role, setRole] = useState<string|undefined>(undefined);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Party[]>([]);

  async function load() {
    const r = await findParties({ role, q });
    setRows(r);
  }
  useRefetchOnFocus(load, { deps: [role, q] });
  useEffect(() => { load(); }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <View style={{ marginBottom: 10 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search parties"
          placeholderTextColor={t.colors.textMuted}
          style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8, padding: 10, color: t.colors.text }}
        />
      </View>

      <ScrollView>
        {rows.map(p => (
          <Pressable key={p.id} onPress={() => navigation.push("PartyDetail", { id: p.id })} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <Text style={{ color: t.colors.text, fontWeight: "600" }}>{p.name}</Text>
            <Text style={{ color: t.colors.textMuted }}>{p.kind} {p.roles?.length ? `· ${p.roles?.join(", ")}` : ""}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable
        onPress={() => navigation.push("PartyDetail", { mode: "new" })}
        style={{ position: "absolute", right: 18, bottom: 18, backgroundColor: t.colors.primary, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
