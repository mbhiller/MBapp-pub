import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { RootStackScreenProps, ObjectRef } from "../navigation/types";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT = process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";

function extractAny(ref: any): { id?: string; type?: string } {
  if (!ref) return {};
  if (ref.id && ref.type) return { id: ref.id, type: ref.type };
  if (ref.obj?.id && ref.obj?.type) return { id: ref.obj.id, type: ref.obj.type };
  if (ref.item?.id && ref.item?.type) return { id: ref.item.id, type: ref.item.type };
  return {};
}

export default function ObjectDetailScreen({ route, navigation }: RootStackScreenProps<"ObjectDetail">) {
  const { id, type } = extractAny(route?.params as any);

  const [obj, setObj] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [epc, setEpc] = useState("");
  const [archived, setArchived] = useState(false);
  const [saving, setSaving] = useState(false);

  const canAttach = useMemo(() => !!id && !!type, [id, type]);

  async function load() {
    if (!id || !type) return;
    setErr(null);
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/objects/${encodeURIComponent(type!)}/${encodeURIComponent(id!)}`, {
        headers: { "x-tenant-id": TENANT },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.message || resp.statusText);
      setObj(data);
      setName(data?.name || "");
      setEpc(data?.tags?.rfidEpc || "");
      setArchived(!!data?.tags?.archived);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!id || !type) return;
    setSaving(true);
    setErr(null);
    try {
      const body: any = {
        name: name?.trim() || undefined,
        tags: { rfidEpc: epc?.trim() ? epc.trim() : null, archived },
      };
      const resp = await fetch(`${API_BASE}/objects/${encodeURIComponent(type!)}/${encodeURIComponent(id!)}`, {
        method: "PUT",
        headers: {
          "x-tenant-id": TENANT,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.message || resp.statusText);
      Alert.alert("Saved", "Object updated.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { load(); }, [id, type]);

  if (!id || !type) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <Text style={{ color: "crimson", textAlign: "center" }}>Missing object id/type.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: "#333" }}>Loading…</Text>
        {err ? <Text style={{ marginTop: 6, color: "crimson" }}>{err}</Text> : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 12, opacity: 0.7, color: "#333" }}>IDENTITY</Text>
      <View style={{ backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#eee", padding: 12 }}>
        <Text style={{ fontSize: 12, color: "#555" }}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="(unnamed)"
          style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10, marginTop: 6 }}
          autoCapitalize="words"
        />
        <Text style={{ marginTop: 10, color: "#333" }}>type: {obj?.type}</Text>
        <Text style={{ marginTop: 2, color: "#333" }}>id: {obj?.id}</Text>
      </View>

      <Text style={{ fontSize: 12, opacity: 0.7, color: "#333", marginTop: 8 }}>RFID</Text>
      <View style={{ backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#eee", padding: 12 }}>
        <Text style={{ fontSize: 12, color: "#555" }}>EPC (rfidEpc)</Text>
        <TextInput
          value={epc}
          onChangeText={setEpc}
          placeholder="Scan or type EPC (leave blank to detach)"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10, marginTop: 6 }}
        />
      </View>

      <Text style={{ fontSize: 12, opacity: 0.7, color: "#333", marginTop: 8 }}>FLAGS</Text>
      <View style={{ backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#eee", padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: "#111", fontWeight: "600" }}>Archived</Text>
        <Switch value={archived} onValueChange={setArchived} />
      </View>

      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={{ backgroundColor: saving ? "#9fbefb" : "#3478f6", padding: 14, borderRadius: 10, alignItems: "center", flex: 1 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>{saving ? "Saving…" : "Save"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.navigate("Scan", { attachTo: { id, type } as ObjectRef, intent: "attach-epc" })}
          style={{ backgroundColor: "#2a8b57", padding: 14, borderRadius: 10, alignItems: "center", flex: 1 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Scan to Attach EPC</Text>
        </TouchableOpacity>
      </View>

      {err ? <Text style={{ marginTop: 8, color: "crimson" }}>{err}</Text> : null}
    </ScrollView>
  );
}
