import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "../providers/AuthProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_INVENTORY_READ, PERM_MESSAGE_READ } from "../generated/permissions";

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
  const canViewMessages = hasPerm(policy, PERM_MESSAGE_READ);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 text-white shadow">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-lg font-semibold">MBapp Web</div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-white/90">
                Tenant: {tenantId} · {tokenStatus}
              </span>
              {policyLoading && <span className="text-white/70">Loading permissions…</span>}
              {policyError && <span className="text-red-200">Permissions unavailable</span>}
              <Input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste bearer token"
                className="w-56 bg-white/90 text-slate-900"
              />
              <Button onClick={() => setToken(tokenInput || null)} disabled={!tokenInput} size="sm">
                Set Token
              </Button>
              <Button
                onClick={() => {
                  setToken(null);
                  setTokenInput("");
                }}
                variant="secondary"
                size="sm"
              >
                Clear Token
              </Button>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <Link className="text-white/90 underline-offset-4 hover:underline" to="/">
              Home
            </Link>
            <Link className="text-white/90 underline-offset-4 hover:underline" to="/events">
              Events
            </Link>
            {canViewParties && (
              <Link className="text-white/90 underline-offset-4 hover:underline" to="/parties">
                Parties
              </Link>
            )}
            {canViewProducts && (
              <Link className="text-white/90 underline-offset-4 hover:underline" to="/products">
                Products
              </Link>
            )}
            {canViewSalesOrders && (
              <Link className="text-white/90 underline-offset-4 hover:underline" to="/sales-orders">
                Sales Orders
              </Link>
            )}
            <Link className="text-white/90 underline-offset-4 hover:underline" to="/backorders">
              Backorders
            </Link>
            {canViewPurchaseOrders && (
              <Link className="text-white/90 underline-offset-4 hover:underline" to="/purchase-orders">
                Purchase Orders
              </Link>
            )}
            {canViewPurchaseOrders && (
              <Link className="text-white/90 underline-offset-4 hover:underline" to="/purchase-orders?vendorMode=1">
                Vendor Portal
              </Link>
            )}
            {canViewInventory && (
              <Link className="text-white/90 underline-offset-4 hover:underline" to="/inventory">
                Inventory
              </Link>
            )}
            {canViewMessages && (
              <Link className="text-white/90 underline-offset-4 hover:underline" to="/messages">
                Messages
              </Link>
            )}
            <Link className="text-white/90 underline-offset-4 hover:underline" to="/locations">
              Locations
            </Link>
            <Link className="text-white/90 underline-offset-4 hover:underline" to="/views">
              Views
            </Link>
            <Link className="text-white/90 underline-offset-4 hover:underline" to="/workspaces">
              Workspaces
            </Link>
            <span className="text-white/60">|</span>
            <Link className="text-white/90 underline-offset-4 hover:underline" to="/docs">
              Docs
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
