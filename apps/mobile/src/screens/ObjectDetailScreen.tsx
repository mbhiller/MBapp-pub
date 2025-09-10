// apps/mobile/src/screens/ObjectDetailScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Switch, Alert } from "react-native";
import { getObject, updateObject, createObject } from "../api/client";
import { toast } from "../ui/Toast";
import { toastFromError } from "../lib/errors";
import { Screen } from "../ui/Screen";
import { Section } from "../ui/Section";
import { NonProdBadge } from "../ui/NonProdBadge";
import { useTheme } from "../ui/ThemeProvider";

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

export default function ObjectDetailScreen({ route }: any) {
  const t = useTheme();
  const { id: routeId, type: routeType } = deriveIdType(route?.params);
  const [obj, setObj] = useState<Obj | null>(routeType ? { type: routeType } : null);
  const [name, setName] = useState<string>("");
  const [epc, setEpc] = useState<string>("");
  const [archived, setArchived] = useState<boolean>(false);
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
        setArchived(Boolean(data?.tags?.archived));
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
        const created = await createObject(objectType, {
          name,
          tags: {
            ...(epc ? { rfidEpc: epc } : {}),
            ...(archived ? { archived: true } : {}),
          },
        });
        setObj({ ...created, type: objectType });
        toast("Created");
      } else {
        const current = await getObject(objectType, objectId);
        const mergedTags = { ...(current?.tags || {}) };
        // EPC merge
        if (epc && epc.trim()) mergedTags.rfidEpc = epc.trim();
        else if ("rfidEpc" in mergedTags) delete mergedTags.rfidEpc;
        // Archived toggle
        if (archived) mergedTags.archived = true;
        else if ("archived" in mergedTags) delete mergedTags.archived;

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
    <Screen title="Object Detail">
      {/* Badge */}
      <View style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
        <NonProdBadge />
      </View>

      <Section label="Object">
        <Text style={{ color: t.textMuted, marginBottom: 4 }}>
          ID: <Text style={{ color: t.text }}>{objectId ?? "—"}</Text>
        </Text>

        <Text style={{ marginTop: 8, color: t.text }}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={t.textMuted}
          style={{
            backgroundColor: "#f2f2f2",
            borderColor: "#e5e5e5",
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: t.text,
          }}
        />

        <Text style={{ marginTop: 8, color: t.text }}>RFID EPC</Text>
        <TextInput
          value={epc}
          onChangeText={setEpc}
          placeholder="RFID EPC (hex)"
          placeholderTextColor={t.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          style={{
            backgroundColor: "#f2f2f2",
            borderColor: "#e5e5e5",
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: t.text,
          }}
        />

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
          <Text style={{ flex: 1, color: t.text }}>Archived</Text>
          <Switch value={archived} onValueChange={setArchived} />
        </View>

        <TouchableOpacity
          disabled={!canSave || saving}
          onPress={onSave}
          style={{
            backgroundColor: !canSave || saving ? "#cbd5e1" : t.primary,
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: "center",
            marginTop: 12,
          }}
        >
          {saving ? <ActivityIndicator /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Save changes</Text>}
        </TouchableOpacity>
      </Section>

      <Section label="Core data">
        <Text style={{ color: t.textMuted }}>No additional core fields found.</Text>
      </Section>

      <Section label="Integrations">
        <Row label="Quickbooks" value={false} />
        <Row label="Usef" value={false} />
        <Row label="Petregistry" value={false} />
      </Section>

      {loading && (
        <View
          style={{
            position: "absolute",
            inset: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.6)",
          }}
        >
          <ActivityIndicator size="large" />
        </View>
      )}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Switch value={value} />
    </View>
  );
}
