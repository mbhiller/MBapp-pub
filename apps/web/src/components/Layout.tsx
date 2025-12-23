import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";

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
        </nav>
      </header>
      <main style={{ padding: "16px" }}>{children}</main>
    </div>
  );
}
