// apps/mobile/src/features/dev/DevDiagnosticsScreen.tsx
import * as React from "react";
import { View, Text, TextInput, ScrollView, Pressable, Platform } from "react-native";
import { apiClient, listObjects, createObject, setApiBase, setTenantId, setBearerToken, _debugConfig } from "../../api/client";

const Row = ({ children }: { children: React.ReactNode }) => (
  <View style={{ marginBottom: 12 }}>{children}</View>
);
const Button = ({ title, onPress }: { title: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: "#111827" }}>
    <Text style={{ color: "white", fontWeight: "600" }}>{title}</Text>
  </Pressable>
);

// local, unsafe decode just for dev UI
function decodeJwt(token: string | null) {
  try {
    if (!token) return null;
    const [, payload] = token.split(".");
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return json;
  } catch {
    return null;
  }
}

export default function DevDiagnosticsScreen() {
  const [apiBase, setApiBaseInput] = React.useState("");
  const [tenant, setTenantInput] = React.useState("DemoTenant");
  const [bearer, setBearerInput] = React.useState("");
  const [moduleType, setModuleType] = React.useState("event");
  const [objectId, setObjectId] = React.useState("");
  const [log, setLog] = React.useState("(no logs yet)");

  const logLine = (s: any) => setLog((p) => `${p}\n${typeof s === "string" ? s : JSON.stringify(s, null, 2)}`);

  function applyEnv() {
    if (apiBase) setApiBase(apiBase);
    if (tenant)  setTenantId(tenant);
    setBearerToken(bearer || null);
    logLine({ applied: true, ..._debugConfig() });
  }

  async function pingHealth() {
    try { logLine(await apiClient.get("/health")); }
    catch (e: any) { logLine(`❌ /health -> ${e.message}`); }
  }

  async function listFive() {
    try {
      const page = await listObjects<any>(moduleType, { limit: 5 });
      logLine({ list: moduleType, count: page.items.length, next: page.next ?? null });
      if (page.items[0]) logLine(page.items[0]);
    } catch (e: any) { logLine(`❌ list ${moduleType} -> ${e.message}`); }
  }

  async function listFiveRaw() {
    try {
      const raw = await apiClient.get<any>(`/objects/${moduleType}?limit=5`);
      logLine({ raw });
    } catch (e: any) { logLine(`❌ raw list ${moduleType} -> ${e.message}`); }
  }

  async function createOne() {
    try {
      const now = Date.now();
      const body =
        moduleType === "event"
          ? { type: "event", name: `Event ${now}`, startsAt: new Date().toISOString(), status: "available", capacity: 10 }
          : { type: moduleType, name: `${moduleType} ${now}` };
      const rec = await createObject<any>(moduleType, body);
      logLine({ created: { id: rec?.id, type: rec?.type } });
    } catch (e: any) { logLine(`❌ create ${moduleType} -> ${e.message}`); }
  }

  async function getById() {
    if (!objectId) return;
    try {
      const obj = await apiClient.get<any>(`/objects/${moduleType}/${objectId}`);
      logLine({ got: obj });
    } catch (e: any) { logLine(`❌ get ${moduleType}/${objectId} -> ${e.message}`); }
  }

  function showConfig() {
    const cfg = _debugConfig();
    const payload = decodeJwt(bearer);
    logLine({ cfg, tokenTenant: payload?.mbapp?.tenantId, roles: payload?.mbapp?.roles, hasPolicy: !!payload?.mbapp?.policy });
  }

  return (
    <ScrollView style={{ flex: 1, padding: 16, backgroundColor: "#0f172a" }}>
      <Text style={{ color: "white", fontSize: 20, fontWeight: "700", marginBottom: 16 }}>Dev Diagnostics</Text>

      <Row>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>API Base</Text>
        <TextInput value={apiBase} onChangeText={setApiBaseInput} placeholder="https://...amazonaws.com" placeholderTextColor="#6b7280"
          autoCapitalize="none" style={{ backgroundColor: "#111827", color: "white", padding: 10, borderRadius: 8 }}/>
      </Row>

      <Row>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Tenant</Text>
        <TextInput value={tenant} onChangeText={setTenantInput} placeholder="DemoTenant" placeholderTextColor="#6b7280"
          autoCapitalize="none" style={{ backgroundColor: "#111827", color: "white", padding: 10, borderRadius: 8 }}/>
      </Row>

      <Row>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Bearer (JWT)</Text>
        <TextInput value={bearer} onChangeText={setBearerInput} placeholder="eyJ..." placeholderTextColor="#6b7280"
          autoCapitalize="none" secureTextEntry style={{ backgroundColor: "#111827", color: "white", padding: 10, borderRadius: 8 }}/>
      </Row>

      <Row>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Module type (singular)</Text>
        <TextInput value={moduleType} onChangeText={setModuleType} placeholder="event, product, inventory, salesOrder..." placeholderTextColor="#6b7280"
          autoCapitalize="none" style={{ backgroundColor: "#111827", color: "white", padding: 10, borderRadius: 8 }}/>
      </Row>

      <Row>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Object id</Text>
        <TextInput value={objectId} onChangeText={setObjectId} placeholder="paste id to GET /objects/{type}/{id}" placeholderTextColor="#6b7280"
          autoCapitalize="none" style={{ backgroundColor: "#111827", color: "white", padding: 10, borderRadius: 8 }}/>
      </Row>

      <Row>
        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <Button title="Apply" onPress={applyEnv} />
          <Button title="Show Config" onPress={showConfig} />
          <Button title="Ping /health" onPress={pingHealth} />
          <Button title="List 5" onPress={listFive} />
          <Button title="List 5 (raw)" onPress={listFiveRaw} />
          <Button title="Create 1" onPress={createOne} />
          <Button title="Get by id" onPress={getById} />
        </View>
      </Row>

      <Row>
        <Text style={{ color: "#9ca3af", marginBottom: 4 }}>Log</Text>
        <View style={{ backgroundColor: "#111827", padding: 10, borderRadius: 8 }}>
          <Text selectable style={{ color: "#e5e7eb", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{log}</Text>
        </View>
      </Row>
    </ScrollView>
  );
}
