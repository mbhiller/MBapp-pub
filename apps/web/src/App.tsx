import React, { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export default function App() {
  const [status, setStatus] = useState<"idle"|"ok"|"error">("idle");
  const [details, setDetails] = useState<string>("");

  useEffect(() => {
    async function check() {
      if (!API_BASE) { setDetails("VITE_API_BASE not set"); return; }
      try {
        const r = await fetch(`${API_BASE}/tenants`, { headers: { "x-tenant-id": "DemoTenant" }});
        setStatus(r.ok ? "ok" : "error");
        setDetails(`GET /tenants → ${r.status}`);
      } catch (e:any) {
        setStatus("error");
        setDetails(e?.message ?? String(e));
      }
    }
    check();
  }, []);

  return (
    <div style={{fontFamily:"system-ui", padding:24}}>
      <h1>MBapp Web</h1>
      <p>API_BASE: <code>{API_BASE || "(not set)"}</code></p>
      <p>Status: <strong>{status}</strong></p>
      <pre>{details}</pre>
    </div>
  );
}
