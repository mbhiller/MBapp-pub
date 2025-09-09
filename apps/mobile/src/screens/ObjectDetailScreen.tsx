import React, { useMemo, useState } from "react";
import { ScrollView, Text, View, Switch, Alert } from "react-native";
import { updateObject } from "../api/client";

export default function ObjectDetailScreen({ route }: any) {
  const initial: any = route?.params?.obj || {};
  const [obj, setObj] = useState<any>(initial);

  // Prefer obj.data; if absent, show a minimal set of top-level non-system fields
  const dataBlock = useMemo(() => {
    const d = obj?.data;
    if (d && typeof d === "object" && Object.keys(d).length) return d;
    const system = new Set(["tenantId","type","id","pk","sk","createdAt","updatedAt","integrations"]);
    const top: Record<string, any> = {};
    for (const [k,v] of Object.entries(obj || {})) {
      if (!system.has(k) && typeof v !== "object") top[k] = v;
    }
    return Object.keys(top).length ? top : undefined;
  }, [obj]);

  const flags = useMemo(() => ({
    quickbooks: Boolean(obj?.integrations?.quickbooks?.enabled),
    usef:       Boolean(obj?.integrations?.usef?.enabled),
    petregistry:Boolean(obj?.integrations?.petregistry?.enabled),
  }), [obj]);

  const onToggle = async (key: "quickbooks"|"usef"|"petregistry", val: boolean) => {
    try {
      // merge existing integrations to avoid clobbering sibling keys
      const merged = {
        ...(obj?.integrations || {}),
        [key]: { ...(obj?.integrations?.[key] || {}), enabled: val }
      };
      const next = await updateObject(obj.type, obj.id, { integrations: merged });
      setObj(next);
    } catch (e: any) {
      Alert.alert("Update failed", e?.response?.data?.error || e?.message || "Could not update integration");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
        {obj?.type?.toUpperCase() || "OBJECT"}
      </Text>
      <Text>ID: {obj?.id || "—"}</Text>

      <Text style={{ fontWeight: "600", marginTop: 16 }}>Core</Text>
      {dataBlock
        ? <Text selectable>{JSON.stringify(dataBlock, null, 2)}</Text>
        : <Text style={{ color:"#666" }}>No core data fields found.</Text>}

      <Text style={{ fontWeight: "600", marginTop: 16 }}>Integrations</Text>
      <View style={{ marginTop: 8, gap: 12 }}>
        {(["quickbooks","usef","petregistry"] as const).map(k => (
          <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ textTransform: "capitalize" }}>{k}</Text>
            <Switch value={flags[k]} onValueChange={(v) => onToggle(k, v)} />
          </View>
        ))}
      </View>

      <Text style={{ fontWeight: "600", marginTop: 16 }}>Raw</Text>
      <Text selectable style={{ color:"#333" }}>{JSON.stringify(obj, null, 2)}</Text>

      <Text style={{ color: "#666", marginTop: 16 }}>
        Updated: {obj?.updatedAt || obj?.createdAt || "—"}
      </Text>
    </ScrollView>
  );
}
