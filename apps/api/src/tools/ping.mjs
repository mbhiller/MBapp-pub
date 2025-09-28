const API = process.env.MBAPP_API_BASE || "http://localhost:3000";
const TENANT = process.env.MBAPP_TENANT_ID || "DemoTenant";
const TOKEN = process.env.MBAPP_TOKEN;

async function j(url, init={}) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

(async () => {
  const health = await j(`${API}/health`);
  console.log("Health:", health);

  if (TOKEN) {
    const policy = await j(`${API}/auth/policy`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "x-tenant-id": TENANT
      }
    });
    console.log("Policy roles:", policy.roles);
  } else {
    console.log("No MBAPP_TOKEN set; skipping policy check.");
  }
})().catch(e => { console.error("Ping failed:", e.message); process.exit(1); });
