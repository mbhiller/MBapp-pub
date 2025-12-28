import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";

const DOCS_BASE = import.meta.env.VITE_MBAPP_DOCS_BASE_URL ?? "https://github.com/MBapp/MBapp-pub/blob/main";

export function Layout({ children }: { children: ReactNode }) {
  const { tenantId, token, setToken } = useAuth();
  const [tokenInput, setTokenInput] = useState("");
  const tokenStatus = token ? "token set" : "token not set";

  return (
    <div style={{ fontFamily: "system-ui", minHeight: "100vh", background: "#f7f7f7", color: "#111" }}>
      <header style={{ padding: "12px 16px", background: "#0b3d91", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700 }}>MBapp Web</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 14 }}>Tenant: {tenantId} · {tokenStatus}</span>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste bearer token"
              style={{ width: 240 }}
            />
            <button onClick={() => setToken(tokenInput || null)} disabled={!tokenInput}>Set Token</button>
            <button onClick={() => { setToken(null); setTokenInput(""); }}>Clear Token</button>
          </div>
        </div>
        <nav style={{ marginTop: 8, display: "flex", gap: 12 }}>
          <Link to="/" style={{ color: "#fff", textDecoration: "underline" }}>Home</Link>
          <Link to="/parties" style={{ color: "#fff", textDecoration: "underline" }}>Parties</Link>
          <Link to="/products" style={{ color: "#fff", textDecoration: "underline" }}>Products</Link>
          <Link to="/sales-orders" style={{ color: "#fff", textDecoration: "underline" }}>Sales Orders</Link>
          <Link to="/backorders" style={{ color: "#fff", textDecoration: "underline" }}>Backorders</Link>
          <Link to="/purchase-orders" style={{ color: "#fff", textDecoration: "underline" }}>Purchase Orders</Link>
          <Link to="/purchase-orders?vendorMode=1" style={{ color: "#fff", textDecoration: "underline" }}>Vendor Portal</Link>
          <Link to="/inventory" style={{ color: "#fff", textDecoration: "underline" }}>Inventory</Link>
          <Link to="/locations" style={{ color: "#fff", textDecoration: "underline" }}>Locations</Link>
          <Link to="/views" style={{ color: "#fff", textDecoration: "underline" }}>Views</Link>
          <Link to="/workspaces" style={{ color: "#fff", textDecoration: "underline" }}>Workspaces</Link>
          <span style={{ color: "#aaa", margin: "0 4px" }}>|</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Docs:</span>
          <a href={`${DOCS_BASE}/docs/MBapp-Foundations.md`} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>Foundations</a>
          <a href={`${DOCS_BASE}/docs/MBapp-Roadmap-Master-v10.0.md`} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>Roadmap</a>
          <a href={`${DOCS_BASE}/docs/MBapp-Working.md`} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>Status</a>
          <a href={`${DOCS_BASE}/docs/smoke-coverage.md`} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>Smoke Coverage</a>
        </nav>
      </header>
      <main style={{ padding: "16px" }}>{children}</main>
    </div>
  );
}
