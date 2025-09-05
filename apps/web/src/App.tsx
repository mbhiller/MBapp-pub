import { useState } from "react";
import { api } from "./lib/api";

export default function App() {
  const [type, setType] = useState("horse");
  const [name, setName] = useState("Test Object");
  const [id, setId] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const logJson = (label: string, data: unknown) =>
    setLog((l) => [`${label}: ${JSON.stringify(data)}`, ...l].slice(0, 50));

  async function checkTenants() {
    const t = await api.getTenants();
    logJson("GET /tenants", t);
  }

  async function create() {
    const r = await api.createObject(type, name);
    setId(r.id ?? "");
    logJson("POST /objects/{type}", r);
  }

  async function getByQuery() {
    if (!id) return alert("No id yet");
    const r = await api.getObjectByQuery(type, id);
    logJson("GET /objects/{type}?id=...", r);
  }

  async function getByPath() {
    if (!id) return alert("No id yet");
    const r = await api.getObjectByPath(type, id);
    logJson("GET /objects/{type}/{id}", r);
  }

  async function update() {
    if (!id) return alert("No id yet");
    const r = await api.updateObject(type, id, name + " (updated)");
    logJson("PUT /objects/{type}/{id}", r);
  }

  async function search() {
    const r = await api.search();
    logJson("GET /objects/search", r);
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1>MBapp Web</h1>
      <p>
        API_BASE: <code>{import.meta.env.VITE_API_BASE}</code>
      </p>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        <label>
          Type
          <input value={type} onChange={(e) => setType(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={checkTenants}>GET /tenants</button>
        <button onClick={create}>POST /objects/{`{type}`}</button>
        <button onClick={getByQuery} disabled={!id}>GET by query (needs id)</button>
        <button onClick={getByPath} disabled={!id}>GET by path (needs id)</button>
        <button onClick={update} disabled={!id}>PUT (needs id)</button>
        <button onClick={search}>GET /objects/search</button>
      </div>

      <p style={{ marginTop: 12 }}>
        Current id: <code>{id || "(none)"}</code>
      </p>

      <h3>Log</h3>
      <pre style={{ background: "#111", color: "#0f0", padding: 12, minHeight: 160, overflow: "auto" }}>
        {log.join("\n")}
      </pre>
    </div>
  );
}
