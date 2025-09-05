import { useState } from "react";
import { api } from "./lib/api";

export default function App() {
  const [type, setType] = useState("horse");
  const [name, setName] = useState("Test Object");
  const [tag, setTag] = useState("blue");
  const [id, setId] = useState("");
  const [list, setList] = useState<any[]>([]);
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [searchList, setSearchList] = useState<any[]>([]);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const logJson = (label: string, data: unknown) =>
    setLog((l) => [`${label}: ${JSON.stringify(data)}`, ...l].slice(0, 50));

  async function tenants() {
    const t = await api.getTenants();
    logJson("GET /tenants", t);
  }
  async function create() {
    const r = await api.createObject(type, name, tag);
    setId(r.id ?? "");
    logJson("POST /objects/{type}", r);
  }
  async function getByQuery() {
    if (!id) return alert("No id");
    const r = await api.getObjectByQuery(type, id);
    logJson("GET by query", r);
  }
  async function getByPath() {
    if (!id) return alert("No id");
    const r = await api.getObjectByPath(type, id);
    logJson("GET by path", r);
  }
  async function update() {
    if (!id) return alert("No id");
    const r = await api.updateObject(type, id, name + " (updated)");
    logJson("PUT", r);
  }
  async function del() {
    if (!id) return alert("No id");
    await api.deleteObject(type, id);
    logJson("DELETE", { ok: true });
  }
  async function doList(next?: boolean) {
    const r = await api.listByType(type, 5, next ? listCursor : undefined);
    setList(next ? [...list, ...(r.items ?? [])] : r.items ?? []);
    setListCursor(r.cursor ?? null);
    logJson("LIST", r);
  }
  async function doSearch(next?: boolean) {
    const r = await api.searchByTag(tag, 5, next ? searchCursor : undefined);
    setSearchList(next ? [...searchList, ...(r.items ?? [])] : r.items ?? []);
    setSearchCursor(r.cursor ?? null);
    logJson("SEARCH", r);
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <h1>MBapp Web</h1>
      <p>API_BASE: <code>{import.meta.env.VITE_API_BASE}</code></p>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3,1fr)" }}>
        <label>Type <input value={type} onChange={(e) => setType(e.target.value)} style={{ width: "100%" }} /></label>
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} /></label>
        <label>Tag <input value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: "100%" }} /></label>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={tenants}>GET /tenants</button>
        <button onClick={create}>POST</button>
        <button onClick={getByQuery} disabled={!id}>GET ?id=</button>
        <button onClick={getByPath} disabled={!id}>GET /{`{id}`}</button>
        <button onClick={update} disabled={!id}>PUT</button>
        <button onClick={del} disabled={!id}>DELETE</button>
        <button onClick={() => doList(false)}>LIST type</button>
        <button onClick={() => doList(true)} disabled={!listCursor}>LIST next</button>
        <button onClick={() => doSearch(false)}>SEARCH tag</button>
        <button onClick={() => doSearch(true)} disabled={!searchCursor}>SEARCH next</button>
      </div>

      <p style={{ marginTop: 12 }}>Current id: <code>{id || "(none)"}</code></p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h3>List items</h3>
          <pre style={{ background: "#111", color: "#0f0", padding: 12, minHeight: 160, overflow: "auto" }}>
            {JSON.stringify(list, null, 2)}
          </pre>
        </div>
        <div>
          <h3>Search results</h3>
          <pre style={{ background: "#111", color: "#0f0", padding: 12, minHeight: 160, overflow: "auto" }}>
            {JSON.stringify(searchList, null, 2)}
          </pre>
        </div>
      </div>

      <h3>Log</h3>
      <pre style={{ background: "#111", color: "#0f0", padding: 12, minHeight: 160, overflow: "auto" }}>
        {log.join("\n")}
      </pre>
    </div>
  );
}
