import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_INVENTORY_READ } from "../generated/permissions";

export function Layout({ children }: { children: ReactNode }) {
  const { tenantId, token, setToken, policy, policyLoading, policyError } = useAuth();
  const [tokenInput, setTokenInput] = useState("");
  const tokenStatus = token ? "token set" : "token not set";

  // Permission checks for gated modules
  const canViewParties = hasPerm(policy, "party:read");
  const canViewProducts = hasPerm(policy, "product:read");
  const canViewSalesOrders = hasPerm(policy, "sales:read");
  const canViewPurchaseOrders = hasPerm(policy, "purchase:read");
  const canViewInventory = hasPerm(policy, PERM_INVENTORY_READ);

  return (
    <div style={{ fontFamily: "system-ui", minHeight: "100vh", background: "#f7f7f7", color: "#111" }}>
      <header style={{ padding: "12px 16px", background: "#0b3d91", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700 }}>MBapp Web</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 14 }}>Tenant: {tenantId} · {tokenStatus}</span>
            {policyLoading && <span style={{ fontSize: 13, color: "#e0e0e0" }}>Loading permissions…</span>}
            {policyError && <span style={{ fontSize: 13, color: "#ffb3b3" }}>Permissions unavailable</span>}
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
          {canViewParties && <Link to="/parties" style={{ color: "#fff", textDecoration: "underline" }}>Parties</Link>}
          {canViewProducts && <Link to="/products" style={{ color: "#fff", textDecoration: "underline" }}>Products</Link>}
          {canViewSalesOrders && <Link to="/sales-orders" style={{ color: "#fff", textDecoration: "underline" }}>Sales Orders</Link>}
          <Link to="/backorders" style={{ color: "#fff", textDecoration: "underline" }}>Backorders</Link>
          {canViewPurchaseOrders && <Link to="/purchase-orders" style={{ color: "#fff", textDecoration: "underline" }}>Purchase Orders</Link>}
          {canViewPurchaseOrders && <Link to="/purchase-orders?vendorMode=1" style={{ color: "#fff", textDecoration: "underline" }}>Vendor Portal</Link>}
          {canViewInventory && <Link to="/inventory" style={{ color: "#fff", textDecoration: "underline" }}>Inventory</Link>}
          <Link to="/locations" style={{ color: "#fff", textDecoration: "underline" }}>Locations</Link>
          <Link to="/views" style={{ color: "#fff", textDecoration: "underline" }}>Views</Link>
          <Link to="/workspaces" style={{ color: "#fff", textDecoration: "underline" }}>Workspaces</Link>
          <span style={{ color: "#aaa", margin: "0 4px" }}>|</span>
          <Link to="/docs" style={{ color: "#fff", textDecoration: "underline" }}>Docs</Link>
        </nav>
      </header>
      <main style={{ padding: "16px" }}>{children}</main>
    </div>
  );
}
