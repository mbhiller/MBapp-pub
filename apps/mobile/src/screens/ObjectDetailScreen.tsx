// apps/mobile/src/screens/ObjectDetailScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Switch, Alert, ScrollView } from "react-native";
import { getObject, updateObject, createObject } from "../api/client";
import { toast } from "../ui/Toast";
import { toastFromError } from "../lib/errors";

type Obj = {
  id?: string;
  type: string;
  name?: string;
  tags?: Record<string, any>;
  core?: Record<string, any>;
  updatedAt?: string;
};

function deriveIdType(params: any): { id?: string; type?: string } {
  const p = params || {};
  const fromRoot = { id: p.id, type: p.type };
  const fromObj = p.obj ? { id: p.obj.id, type: p.obj.type } : {};
  const fromItem = p.item ? { id: p.item.id, type: p.item.type } : {};
  const id = fromRoot.id || fromObj.id || fromItem.id;
  const type = fromRoot.type || fromObj.type || fromItem.type;
  return { id, type };
}

export default function ObjectDetailScreen({ route, navigation }: any) {
  const { id: routeId, type: routeType } = deriveIdType(route?.params);
  const [obj, setObj] = useState<Obj | null>(routeType ? { type: routeType } : null);
  const [name, setName] = useState<string>("");
  const [epc, setEpc] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(!!(routeId && routeType));
  const [saving, setSaving] = useState<boolean>(false);
  const [quickbooks, setQuickbooks] = useState(false);
  const [usef, setUsef] = useState(false);
  const [petregistry, setPetregistry] = useState(false);

  // Load existing object if id+type provided
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!routeId || !routeType) return;
      setLoading(true);
      try {
        const data = await getObject(routeType, routeId);
        if (!mounted) return;
        setObj({ ...data, type: routeType });
        setName(data?.name ?? "");
        setEpc(data?.tags?.rfidEpc ?? "");
      } catch (e) {
        toastFromError(e, "Load failed");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [routeId, routeType]);

  const objectId = obj?.id || routeId;
  const objectType = obj?.type || routeType;

  const canSave = useMemo(() => {
    if (!objectType) return false;
    if (objectId) return true; // update path
    return (name || "").trim().length > 0; // create path requires name
  }, [name, objectId, objectType]);

  const onSave = async () => {
    if (!objectType) {
      Alert.alert("Missing type", "Object type is required.");
      return;
    }
    setSaving(true);
    try {
      if (!objectId) {
        // Create new
        const created = await createObject(objectType, { name, tags: epc ? { rfidEpc: epc } : undefined });
        setObj({ ...created, type: objectType });
        toast("Created");
        // Show the new id in UI
      } else {
        // Update existing
        const current = await getObject(objectType, objectId);
        const mergedTags = { ...(current?.tags || {}) };
        if (epc && epc.trim()) mergedTags.rfidEpc = epc.trim();
        else if ("rfidEpc" in mergedTags) delete mergedTags.rfidEpc;

        const updated = await updateObject(objectType, objectId, {
          name: name || undefined,
          tags: Object.keys(mergedTags).length ? mergedTags : undefined,
        });
        setObj({ ...updated, type: objectType });
        toast("Saved");
      }
    } catch (e) {
      toastFromError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#f4f4f5" }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Object Detail</Text>
      </View>

      <View style={{ backgroundColor: "#fff", margin: 12, borderRadius: 12, padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 12, color: "#666", letterSpacing: 1.2 }}>OBJECT</Text>

        <Text style={{ color: "#888" }}>ID: <Text style={{ color: "#000" }}>{objectId ?? "—"}</Text></Text>

        <Text style={{ marginTop: 8, color: "#333" }}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor="#aaa"
          style={{ backgroundColor: "#f2f2f2", borderColor: "#e5e5e5", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
        />

        <Text style={{ marginTop: 8, color: "#333" }}>RFID EPC</Text>
        <TextInput
          value={epc}
          onChangeText={setEpc}
          placeholder="RFID EPC (hex)"
          placeholderTextColor="#aaa"
          autoCapitalize="characters"
          autoCorrect={false}
          style={{ backgroundColor: "#f2f2f2", borderColor: "#e5e5e5", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
        />

        <TouchableOpacity
          disabled={!canSave || saving}
          onPress={onSave}
          style={{
            backgroundColor: !canSave || saving ? "#cbd5e1" : "#2563eb",
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: "center",
            marginTop: 6,
          }}
        >
          {saving ? <ActivityIndicator /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Save changes</Text>}
        </TouchableOpacity>
      </View>

      <View style={{ backgroundColor: "#fff", marginHorizontal: 12, marginBottom: 12, borderRadius: 12, padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 12, color: "#666", letterSpacing: 1.2 }}>Core data</Text>
        <Text style={{ color: "#666" }}>No additional core fields found.</Text>
      </View>

      <View style={{ backgroundColor: "#fff", marginHorizontal: 12, borderRadius: 12, padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 12, color: "#666", letterSpacing: 1.2 }}>Integrations</Text>

        <Row label="Quickbooks" value={quickbooks} onChange={setQuickbooks} />
        <Row label="Usef" value={usef} onChange={setUsef} />
        <Row label="Petregistry" value={petregistry} onChange={setPetregistry} />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={{ color: "#888" }}>Updated: <Text style={{ color: "#000" }}>{obj?.updatedAt ?? "—"}</Text></Text>
      </View>

      {loading && (
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)" }}>
          <ActivityIndicator size="large" />
        </View>
      )}
    </ScrollView>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}>
      <Text style={{ flex: 1, color: "#111" }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}
